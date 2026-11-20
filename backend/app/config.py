"""应用程序配置管理"""

from pathlib import Path
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    # MySQL 数据库配置
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""
    DB_NAME: str = "doc_qa"

    # AI 微服务地址与内部通信密钥（留空表示本地免密开发模式）
    AI_SERVICE_URL: str = "http://127.0.0.1:8003"
    INTERNAL_API_TOKEN: str = ""

    # Redis 缓存配置
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    # JWT 认证配置（生产环境请务必在 backend/.env 中配置强随机密钥）
    JWT_SECRET_KEY: str = "docqa-dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440  # 24小时

    # CORS 配置（默认限定本地开发源，避免与 allow_credentials=True 冲突）
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8002",
        "http://127.0.0.1:8002",
    ]

    # Redis 降级配置
    REDIS_FALLBACK_TO_FAKE: bool = True  # 真实 Redis 不可用时降级到本地 SQLite DiskCache

    # 缓存配置
    CACHE_EXPIRE_SECONDS: int = 600  # 默认缓存10分钟
    CACHE_KEY_PREFIX: str = "doc:qa:"

    # 数据库连接字符串 (自动对用户名密码进行 URL 编码，防止含 @/#/% 特殊字符报错)
    @property
    def DATABASE_URL(self) -> str:
        user = quote_plus(self.DB_USER)
        password = quote_plus(self.DB_PASSWORD)
        return (
            f"mysql+pymysql://{user}:{password}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
            f"?charset=utf8mb4"
        )

    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
