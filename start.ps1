# DocQA 一键启动脚本（单主控终端 + Win32 Job Object 托管子进程）
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
if (-not [Console]::IsOutputRedirected) {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$ai = Join-Path $root "ai_service"
$dist = Join-Path $frontend "dist"

$aiPort = 8003
$bePort = 8002

# ── Win32 Job Object 托管辅助类（关闭主终端即由内核级联终止所有子进程） ──
if (-not ("DocQA.JobObjectHelper" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace DocQA {
    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public Int64 PerProcessUserTimeLimit;
        public Int64 PerJobUserTimeLimit;
        public UInt32 LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public UInt32 ActiveProcessLimit;
        public IntPtr Affinity;
        public UInt32 PriorityClass;
        public UInt32 SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
        public UInt64 ReadOperationCount;
        public UInt64 WriteOperationCount;
        public UInt64 OtherOperationCount;
        public UInt64 ReadTransferCount;
        public UInt64 WriteTransferCount;
        public UInt64 OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    public static class JobObjectHelper {
        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(
            IntPtr hJob,
            int JobObjectInfoClass,
            IntPtr lpJobObjectInfo,
            uint cbJobObjectInfoLength
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CloseHandle(IntPtr hObject);

        public static IntPtr CreateKillOnCloseJob() {
            IntPtr hJob = CreateJobObject(IntPtr.Zero, null);
            if (hJob == IntPtr.Zero) {
                throw new InvalidOperationException("CreateJobObject 失败，Win32 错误码: " + Marshal.GetLastWin32Error());
            }

            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr infoPtr = Marshal.AllocHGlobal(length);
            try {
                Marshal.StructureToPtr(info, infoPtr, false);
                if (!SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, infoPtr, (uint)length)) {
                    int err = Marshal.GetLastWin32Error();
                    CloseHandle(hJob);
                    throw new InvalidOperationException("SetInformationJobObject 失败，Win32 错误码: " + err);
                }
            } finally {
                Marshal.FreeHGlobal(infoPtr);
            }
            return hJob;
        }

        public static bool AssignProcess(IntPtr hJob, IntPtr hProcess) {
            if (hJob == IntPtr.Zero || hProcess == IntPtr.Zero) return false;
            return AssignProcessToJobObject(hJob, hProcess);
        }
    }
}
"@
}

function Resolve-PythonExecutable {
    foreach ($candidate in @("python", "python3.11", "python3")) {
        $cmds = Get-Command $candidate -All -ErrorAction SilentlyContinue
        foreach ($cmd in $cmds) {
            if ($cmd.CommandType -ne "Application") { continue }
            try {
                $verOut = & $cmd.Source --version 2>&1
                if ($LASTEXITCODE -eq 0 -and ("$verOut" -match "Python 3\.")) {
                    return $cmd.Source
                }
            } catch {
                # 跳过未安装的 WindowsApps 空壳或不可用路径
            }
        }
    }
    return $null
}

function Test-PortOccupied {
    param([int]$Port)
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $pids = ($conns | Select-Object -ExpandProperty OwningProcess -Unique)
        $details = foreach ($procId in $pids) {
            $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
            if ($p) { "PID $procId ($($p.ProcessName))" } else { "PID $procId" }
        }
        return ($details -join ", ")
    }
    return $null
}

function Show-LogTail {
    param([string]$Title, [string]$OutLog, [string]$ErrLog)
    Write-Host ""
    Write-Host "----- $Title 近期日志 -----" -ForegroundColor Red
    foreach ($file in @($ErrLog, $OutLog)) {
        if (Test-Path $file) {
            $lines = Get-Content -Path $file -Tail 25 -ErrorAction SilentlyContinue
            if ($lines) {
                Write-Host "[$file]" -ForegroundColor DarkGray
                $lines | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
            }
        }
    }
    Write-Host "----------------------------------------" -ForegroundColor Red
}

function Stop-ManagedProcess {
    param($Process, [string]$Name)
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) {
            Write-Host "  正在停止 $Name (PID: $($Process.Id))..." -ForegroundColor Yellow
            # 先尝试结束整棵进程树，兜底 Stop-Process
            & taskkill.exe /PID $Process.Id /T /F 2>&1 | Out-Null
            if (-not $Process.HasExited) {
                Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}
}

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   DocQA · 企业知识库智能问答系统" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 探测 Python 解释器
$pythonExe = Resolve-PythonExecutable
if (-not $pythonExe) {
    Write-Host "[错误] 未检测到可用的 Python 3 环境，请确认 python 已加入 PATH。" -ForegroundColor Red
    exit 1
}
$pyVer = (& $pythonExe --version 2>&1)
Write-Host "[环境] Python: $pyVer ($pythonExe)" -ForegroundColor Gray

# 2. 检查端口占用
foreach ($port in @($aiPort, $bePort)) {
    $holder = Test-PortOccupied -Port $port
    if ($holder) {
        Write-Host "[错误] 端口 $port 已被占用: $holder" -ForegroundColor Red
        Write-Host "       请先关闭旧的服务窗口或结束占用进程后重试。" -ForegroundColor Yellow
        exit 1
    }
}

# 3. 检查前端是否需要重新构建（在打开浏览器前同步完成）
$distIndex = Join-Path $dist "index.html"
$needsBuild = -not (Test-Path $distIndex)
if (-not $needsBuild -and (Test-Path (Join-Path $frontend "src"))) {
    $srcItems = @(Get-ChildItem (Join-Path $frontend "src") -Recurse -File -ErrorAction SilentlyContinue)
    foreach ($extra in @("index.html", "package.json", "vite.config.ts", "tailwind.config.js")) {
        $extraPath = Join-Path $frontend $extra
        if (Test-Path $extraPath) { $srcItems += Get-Item $extraPath }
    }
    $latestSrc = ($srcItems | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
    $latestDist = (Get-ChildItem $dist -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
    if ($latestSrc -gt $latestDist) { $needsBuild = $true }
}

if ($needsBuild) {
    Write-Host "[1/4] 检测到前端源码有更新或缺少 dist，正在执行 npm run build..." -ForegroundColor Yellow
    Push-Location $frontend
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[错误] 前端构建失败，退出码: $LASTEXITCODE" -ForegroundColor Red
            exit 1
        }
    } finally {
        Pop-Location
    }
    Write-Host "      前端构建完成。" -ForegroundColor Green
} else {
    Write-Host "[1/4] 前端 dist 已是最新，跳过构建。" -ForegroundColor Gray
}

# 4. 清理代理环境变量，配置离线模型开关与日志路径
$env:ALL_PROXY = ""
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:HF_HUB_OFFLINE = "1"

$logDir = Join-Path $env:TEMP "docqa_logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$aiLog = Join-Path $logDir "ai_service.log"
$aiErr = Join-Path $logDir "ai_service_err.log"
$beLog = Join-Path $logDir "backend.log"
$beErr = Join-Path $logDir "backend_err.log"
foreach ($f in @($aiLog, $aiErr, $beLog, $beErr)) {
    if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

$jobHandle = [IntPtr]::Zero
$aiProc = $null
$beProc = $null

try {
    $jobHandle = [DocQA.JobObjectHelper]::CreateKillOnCloseJob()

    Write-Host "[2/4] 启动 AI 检索服务 (127.0.0.1:$aiPort)..." -ForegroundColor Yellow
    $aiProc = Start-Process -FilePath $pythonExe `
        -ArgumentList "-m uvicorn main:app --host 127.0.0.1 --port $aiPort --log-level info" `
        -WorkingDirectory $ai `
        -WindowStyle Hidden `
        -RedirectStandardOutput $aiLog `
        -RedirectStandardError $aiErr `
        -PassThru
    $null = [DocQA.JobObjectHelper]::AssignProcess($jobHandle, $aiProc.Handle)

    Write-Host "[3/4] 启动业务后端服务 (127.0.0.1:$bePort)..." -ForegroundColor Yellow
    $beProc = Start-Process -FilePath $pythonExe `
        -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port $bePort --log-level info" `
        -WorkingDirectory $backend `
        -WindowStyle Hidden `
        -RedirectStandardOutput $beLog `
        -RedirectStandardError $beErr `
        -PassThru
    $null = [DocQA.JobObjectHelper]::AssignProcess($jobHandle, $beProc.Handle)

    Write-Host "[4/4] 等待服务健康检查就绪..." -ForegroundColor Yellow
    $aiReady = $false
    $beReady = $false
    $deadline = [datetime]::Now.AddSeconds(60)

    while ([datetime]::Now -lt $deadline -and -not ($aiReady -and $beReady)) {
        if ($aiProc.HasExited) {
            Write-Host "[错误] AI 服务进程意外退出 (退出码: $($aiProc.ExitCode))" -ForegroundColor Red
            Show-LogTail -Title "AI 服务" -OutLog $aiLog -ErrLog $aiErr
            exit 1
        }
        if ($beProc.HasExited) {
            Write-Host "[错误] 业务后端进程意外退出 (退出码: $($beProc.ExitCode))" -ForegroundColor Red
            Show-LogTail -Title "业务后端" -OutLog $beLog -ErrLog $beErr
            exit 1
        }

        if (-not $aiReady) {
            try {
                $r = Invoke-WebRequest "http://127.0.0.1:$aiPort/health" -TimeoutSec 1 -UseBasicParsing
                if ($r.StatusCode -eq 200) {
                    $aiReady = $true
                    Write-Host "      AI 服务已就绪。" -ForegroundColor Green
                }
            } catch {}
        }
        if (-not $beReady) {
            try {
                $r = Invoke-WebRequest "http://127.0.0.1:$bePort/api/health" -TimeoutSec 1 -UseBasicParsing
                if ($r.StatusCode -eq 200) {
                    $beReady = $true
                    Write-Host "      业务后端已就绪。" -ForegroundColor Green
                }
            } catch {}
        }

        if (-not ($aiReady -and $beReady)) {
            Start-Sleep -Milliseconds 300
        }
    }

    if (-not ($aiReady -and $beReady)) {
        $still = @()
        if (-not $aiReady) { $still += "AI 服务" }
        if (-not $beReady) { $still += "业务后端" }
        Write-Host "[警告] 等待超时（未就绪: $($still -join '、')），请检查日志排查。" -ForegroundColor DarkYellow
        if (-not $aiReady) { Show-LogTail -Title "AI 服务" -OutLog $aiLog -ErrLog $aiErr }
        if (-not $beReady) { Show-LogTail -Title "业务后端" -OutLog $beLog -ErrLog $beErr }
    } elseif (-not $NoBrowser) {
        Start-Process "http://localhost:$bePort"
    }

    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "  DocQA 正在运行" -ForegroundColor Green
    Write-Host "  访问地址:   http://localhost:$bePort" -ForegroundColor White
    Write-Host "  接口文档:   http://localhost:$bePort/docs" -ForegroundColor Gray
    Write-Host "  AI 服务:    http://127.0.0.1:$aiPort  (PID: $($aiProc.Id))" -ForegroundColor Gray
    Write-Host "  业务后端:   http://127.0.0.1:$bePort  (PID: $($beProc.Id))" -ForegroundColor Gray
    Write-Host "  日志目录:   $logDir" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  >> 按 Ctrl+C、输入 Q 键，或直接关闭此窗口 (×) 即可停止所有服务 <<" -ForegroundColor Yellow
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host ""

    # 主控常驻监控循环
    while ($true) {
        if ($aiProc.HasExited) {
            Write-Host "[异常] AI 服务进程意外退出 (退出码: $($aiProc.ExitCode))" -ForegroundColor Red
            Show-LogTail -Title "AI 服务" -OutLog $aiLog -ErrLog $aiErr
            exit 1
        }
        if ($beProc.HasExited) {
            Write-Host "[异常] 业务后端进程意外退出 (退出码: $($beProc.ExitCode))" -ForegroundColor Red
            Show-LogTail -Title "业务后端" -OutLog $beLog -ErrLog $beErr
            exit 1
        }

        try {
            if (-not [Console]::IsInputRedirected -and [Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true)
                if ($key.Key -eq [ConsoleKey]::Q) {
                    Write-Host "收到退出指令 (Q)，正在关闭服务..." -ForegroundColor Yellow
                    break
                }
            }
        } catch {}

        Start-Sleep -Milliseconds 500
    }
} finally {
    Write-Host ""
    Write-Host "正在停止 DocQA 所有后台服务..." -ForegroundColor Yellow
    Stop-ManagedProcess -Process $beProc -Name "业务后端"
    Stop-ManagedProcess -Process $aiProc -Name "AI 服务"
    if ($jobHandle -ne [IntPtr]::Zero) {
        $null = [DocQA.JobObjectHelper]::CloseHandle($jobHandle)
    }
    Write-Host "所有服务已安全停止。" -ForegroundColor Green
}
