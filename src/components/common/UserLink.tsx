// 统一用户入口：头像 / 用户名点击后进入应用内「用户主页」
//
// 背景：此前大量页面把头像或用户名指向 github.com（或根本没有绑定点击），
// 在 WebView APK 内会跳出应用或直接无响应，用户无法查看作者主页与其所有仓库。
// 这里提供轻量组件，保证任意页面点击头像/用户名都走 React Router 内部路由。
import type { ReactNode, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function userProfilePath(login: string): string {
  return `/users/${encodeURIComponent(login)}`;
}

interface UserLinkProps {
  login: string;
  children: ReactNode;
  className?: string;
  title?: string;
  /** 默认阻止冒泡，避免卡片本身的点击（进入仓库/Issue）被同时触发 */
  stopPropagation?: boolean;
}

/**
 * 把任意内容包成「进入用户主页」的链接。
 * 使用 <a href="#/users/..."> 保留 Web 语义（可长按复制/新标签打开），
 * 点击时用 navigate 走 SPA 路由，避免 WebView 重新加载页面。
 */
export function UserLink({
  login,
  children,
  className,
  title,
  stopPropagation = true,
}: UserLinkProps) {
  const navigate = useNavigate();
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (stopPropagation) e.stopPropagation();
    // 让浏览器默认行为（新标签/中键）在其他按钮上继续生效
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(userProfilePath(login));
  };
  return (
    <a
      href={`#${userProfilePath(login)}`}
      title={title ?? `@${login}`}
      onClick={handleClick}
      className={cn('cursor-pointer', className)}
    >
      {children}
    </a>
  );
}
