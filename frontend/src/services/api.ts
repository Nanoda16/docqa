import axios from 'axios';
import { message } from 'antd';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** 为 true 时不自动弹出全局错误提示 */
    silentError?: boolean;
  }
}

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

let tokenGetter: () => string | null = () => localStorage.getItem('token');

export const setTokenGetter = (getter: () => string | null) => {
  tokenGetter = getter;
};

/**
 * 将后端 / 网络异常转换为友好的中文提示。
 */
function humanizeError(error: any): string {
  const detail = error?.response?.data?.detail;

  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    const msgs = detail.map((d: any) => d?.msg).filter(Boolean);
    return msgs.length ? msgs.join('；') : '提交的内容格式不正确';
  }

  if (!error?.response) {
    if (error?.code === 'ECONNABORTED') return '请求超时，请稍后重试';
    return '无法连接后端服务，请确认后端服务已启动';
  }

  switch (error.response.status) {
    case 400:
      return '请求参数有误，请检查填写内容';
    case 401:
      return '登录已过期，请重新登录';
    case 403:
      return '当前账号没有权限执行该操作';
    case 404:
      return '访问的资源不存在';
    case 422:
      return '提交的数据格式不正确';
    case 502:
    case 503:
    case 504:
      return '依赖服务暂时不可用，请稍后重试';
    case 500:
      return '服务端处理请求时发生异常，请查看后端日志';
    default:
      return `请求失败（${error.response.status}）`;
  }
}

api.interceptors.request.use((config) => {
  const token = tokenGetter();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const silent = Boolean(error?.config?.silentError);
    if (error.response?.status === 401) {
      if (!silent) {
        message.error('登录已过期，请重新登录');
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    } else if (!silent) {
      message.error(humanizeError(error));
    }
    return Promise.reject(error);
  }
);

export default api;
