// 开源应用商店风格仓库详情页
// 搜索结果点击后先进本页，页内「进入仓库」再跳本项目 /repos/:owner/:repo
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Star,
  GitFork,
  Download,
  AlertCircle,
  Clock,
  Tag,
  Scale,
  Code2,
  RefreshCw,
  Smartphone,
  Monitor,
  Terminal,
  Tv,
  Copy,
  ExternalLink,
  ChevronDown,
  Calendar,
  History,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  getRepo,
  getReleases,
  getRepoLanguages,
  formatNumber,
  formatRelativeTime,
  getLanguageColor,
} from '@/services/github';
import type { GitHubRelease, GitHubReleaseAsset } from '@/services/github';
import type { GitHubRepo } from '@/types/types';
import { copyToClipboard } from '@/lib/utils';
import i18n from '@/i18n';

/* ---------------- 平台识别 ---------------- */

type PlatformKey = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'tv' | 'other';

const PLATFORM_META: Record<PlatformKey, { label: string; Icon: typeof Smartphone }> = {
  android: { label: 'Android', Icon: Smartphone },
  ios: { label: 'iOS', Icon: Smartphone },
  windows: { label: 'Windows', Icon: Monitor },
  macos: { label: 'macOS', Icon: Monitor },
  linux: { label: 'Linux', Icon: Terminal },
  tv: { label: 'TV', Icon: Tv },
  other: { label: '其他', Icon: Tag },
};

/** 按产物文件名推断目标平台 */
function detectPlatform(name: string): PlatformKey {
  const n = name.toLowerCase();
  if (/\.apk$|\.aab$|\.xapk$|\.apks$/.test(n)) return 'android';
  if (/\.ipa$/.test(n) || /ios/.test(n)) return 'ios';
  if (/\.exe$|\.msi$|\.msix$/.test(n) || /win(dows)?/.test(n)) return 'windows';
  if (/\.dmg$|\.pkg$/.test(n) || /mac(os)?/.test(n)) return 'macos';
  if (/\.deb$|\.rpm$|\.appimage$|\.flatpak$|\.snap$/.test(n) || /linux/.test(n)) return 'linux';
  if (/androidtv|android[_-]?tv/.test(n)) return 'tv';
  return 'other';
}

/** 把字节数格式化为易读体积 */
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const digits = value >= 100 || i === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[i]}`;
}

/** 把 ISO 时间格式化为 YYYY/MM/DD，无效值返回 — */
function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}/${m}/${day}`;
}

/* ---------------- 页面 ---------------- */

export default function AppStoreRepoDetailPage() {
  const { owner = '', repo: repoName = '' } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();

  const [repo, setRepo] = useState<GitHubRepo | null>(null);
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [languages, setLanguages] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 历史版本展开状态：记录已展开的 release id
  const [expandedReleases, setExpandedReleases] = useState<number[]>([]);

  const load = useCallback(async () => {
    if (!owner || !repoName) return;
    setLoading(true);
    setError(null);
    try {
      const repoData = await getRepo(owner, repoName);
      setRepo(repoData);
      // 以下为增强信息，单项失败不阻塞主页面
      const [releaseData, langData] = await Promise.all([
        getReleases(owner, repoName, { per_page: 10 }).catch(() => [] as GitHubRelease[]),
        getRepoLanguages(owner, repoName).catch(() => ({}) as Record<string, number>),
      ]);
      setReleases(releaseData);
      setLanguages(langData ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : i18n.t('加载失败'));
    } finally {
      setLoading(false);
    }
  }, [owner, repoName]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- 派生数据 ---------- */

  const latestRelease = releases.find((r) => !r.draft && !r.prerelease) ?? releases[0] ?? null;
  const assets: GitHubReleaseAsset[] = latestRelease?.assets ?? [];

  // 历史版本：排除最新版后按发布时间倒序（GitHub API 按创建时间排序，发布日未必有序）
  const historyReleases = releases
    .filter((r) => r.id !== latestRelease?.id)
    .sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    });

  // 平台标签：由最新 Release 产物推断
  const platforms: PlatformKey[] = (() => {
    const set = new Set<PlatformKey>();
    assets.forEach((a) => set.add(detectPlatform(a.name)));
    set.delete('other');
    return Array.from(set);
  })();

  const primaryLanguage = repo?.language ?? Object.keys(languages)[0] ?? null;
  const licenseText =
    repo?.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
      ? repo.license.spdx_id
      : repo?.license?.name || i18n.t('未知');

  const displayName = repo?.name || repoName;
  const avatarSrc = repo?.owner?.avatar_url;

  const goRealRepo = () => navigate(`/repos/${owner}/${repoName}`);

  /* ---------- 渲染 ---------- */

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex gap-3">
            <Skeleton className="h-20 w-20 rounded-2xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error || !repo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{error || i18n.t('仓库不存在')}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-sm text-foreground"
            >
              <RefreshCw className="w-4 h-4" />
              {i18n.t('重试')}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm"
            >
              {i18n.t('返回')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="max-w-3xl mx-auto px-4 pt-3 pb-4 space-y-4">
        {/* 顶部返回 */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={i18n.t('返回')}
            className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              copyToClipboard(repo.html_url);
              toast.success(i18n.t('仓库地址已复制'));
            }}
            aria-label={i18n.t('复制仓库地址')}
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>

        {/* 应用头部：图标 + 名称 + 描述 + 平台标签 */}
        <div className="flex items-start gap-4">
          <Avatar className="h-[76px] w-[76px] rounded-[20px] shrink-0 border border-border bg-secondary">
            <AvatarImage
              src={avatarSrc}
              alt={displayName}
              className="rounded-[20px] object-cover"
              loading="lazy"
            />
            <AvatarFallback className="rounded-[20px] bg-secondary text-xl font-semibold text-muted-foreground">
              {displayName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-semibold text-foreground truncate leading-tight">
                  {displayName}
                </h1>
                <p className="text-[13px] text-muted-foreground truncate mt-0.5">
                  {repo.full_name}
                </p>
              </div>
              <button
                type="button"
                onClick={goRealRepo}
                className="shrink-0 inline-flex items-center gap-0.5 px-3.5 py-1.5 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold leading-none active:scale-[0.97] transition-transform"
              >
                {i18n.t('进入仓库')}
              </button>
            </div>

            {/* Stars / Forks */}
            <div className="flex items-center gap-3 mt-2 text-[12px] text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5" />
                {formatNumber(repo.stargazers_count)} Stars
              </span>
              <span className="flex items-center gap-1">
                <GitFork className="w-3.5 h-3.5" />
                {formatNumber(repo.forks_count)} Forks
              </span>
            </div>

            {/* 最新版本 */}
            {latestRelease && (
              <div className="mt-2 text-[12px] text-muted-foreground flex items-center gap-1">
                <Tag className="w-3.5 h-3.5" />
                {i18n.t('最新版本')} {latestRelease.tag_name}
              </div>
            )}

            {/* 平台标签 */}
            {platforms.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {platforms.map((p) => {
                  const { label, Icon } = PLATFORM_META[p];
                  return (
                    <span
                      key={p}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary text-[11px] text-foreground/80 leading-none"
                    >
                      <Icon className="w-3 h-3" />
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 简介 */}
        {repo.description && (
          <p className="text-[13px] leading-relaxed text-foreground/85 text-pretty">
            {repo.description}
          </p>
        )}

        {/* 下载区 */}
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{i18n.t('下载')}</h2>
            {latestRelease && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {latestRelease.tag_name}
              </span>
            )}
          </div>

          {assets.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] text-muted-foreground">
                {i18n.t('该项目暂无 Release 产物')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {assets.map((asset) => {
                const platform = detectPlatform(asset.name);
                const { Icon } = PLATFORM_META[platform];
                return (
                  <li key={asset.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-foreground/70" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground truncate">{asset.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatSize(asset.size)} · {formatNumber(asset.download_count)}
                        {i18n.t('次下载')}
                      </p>
                    </div>
                    <a
                      href={asset.browser_download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 px-3 py-1.5 rounded-full border border-primary text-primary text-[12px] font-semibold leading-none"
                    >
                      {i18n.t('下载')}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 项目信息 */}
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Code2 className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">{i18n.t('项目信息')}</h2>
          </div>
          <dl className="divide-y divide-border">
            <div className="flex items-center gap-3 px-4 py-3">
              <Scale className="w-4 h-4 text-muted-foreground shrink-0" />
              <dt className="text-[13px] text-muted-foreground">{i18n.t('许可证')}</dt>
              <dd className="ml-auto text-[13px] text-foreground truncate max-w-[60%]">
                {licenseText}
              </dd>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <Code2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <dt className="text-[13px] text-muted-foreground">{i18n.t('语言')}</dt>
              <dd className="ml-auto text-[13px] text-foreground flex items-center gap-1.5">
                {primaryLanguage ? (
                  <>
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: getLanguageColor(primaryLanguage) }}
                    />
                    {primaryLanguage}
                  </>
                ) : (
                  i18n.t('未知')
                )}
              </dd>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <dt className="text-[13px] text-muted-foreground">{i18n.t('最近更新')}</dt>
              <dd className="ml-auto text-[13px] text-foreground">
                {formatRelativeTime(repo.pushed_at || repo.updated_at)}
              </dd>
            </div>
            {latestRelease?.published_at && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                <dt className="text-[13px] text-muted-foreground">{i18n.t('发布时间')}</dt>
                <dd className="ml-auto text-[13px] text-foreground">
                  {formatDate(latestRelease.published_at)}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* 历史版本 */}
        {historyReleases.length > 0 && (
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">{i18n.t('历史版本')}</h2>
            </div>
            <ul className="divide-y divide-border">
              {historyReleases.map((release) => {
                const expanded = expandedReleases.includes(release.id);
                const versionAssets = release.assets ?? [];
                return (
                  <li key={release.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedReleases((prev) =>
                          prev.includes(release.id)
                            ? prev.filter((id) => id !== release.id)
                            : [...prev, release.id],
                        )
                      }
                      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-secondary/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-foreground truncate">
                          {i18n.t('历史版本')} {release.tag_name}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {formatDate(release.published_at)}
                          {versionAssets.length > 0 &&
                            ` · ${versionAssets.length}${i18n.t('个文件')}`}
                        </p>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${
                          expanded ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {expanded && (
                      <ul className="bg-secondary/30 divide-y divide-border">
                        {versionAssets.length === 0 ? (
                          <li className="px-4 py-3 text-[12px] text-muted-foreground">
                            {i18n.t('该版本暂无产物')}
                          </li>
                        ) : (
                          versionAssets.map((asset) => {
                            const platform = detectPlatform(asset.name);
                            const { Icon } = PLATFORM_META[platform];
                            return (
                              <li
                                key={asset.id}
                                className="flex items-center gap-3 pl-6 pr-4 py-2.5"
                              >
                                <Icon className="w-3.5 h-3.5 text-foreground/60 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-[12px] text-foreground truncate">
                                    {asset.name}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {formatSize(asset.size)} ·{' '}
                                    {formatNumber(asset.download_count)}
                                    {i18n.t('次下载')}
                                  </p>
                                </div>
                                <a
                                  href={asset.browser_download_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 px-2.5 py-1 rounded-full border border-primary text-primary text-[11px] font-semibold leading-none"
                                >
                                  {i18n.t('下载')}
                                </a>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* 底部：安全提示 + 在 GitHub 查看 */}
        <div className="space-y-2.5 pt-1">
          <p className="text-[11px] text-muted-foreground text-center leading-relaxed px-2">
            {i18n.t('安装包来自 GitHub Release，请确认来源可信后再安装，建议仅安装您熟悉的开源项目。')}
          </p>
          <a
            href={repo.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {i18n.t('在 GitHub 查看')}
          </a>
        </div>
      </div>
    </div>
  );
}