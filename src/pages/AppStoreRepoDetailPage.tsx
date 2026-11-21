// 开源应用商店风格仓库详情页
// 搜索结果点击后先进本页，页内「进入仓库」再跳本项目 /repos/:owner/:repo
// 视觉基准：参照站（appmiaoda 开源应用商店）真实 DOM 计算样式，逐项对齐字号/字重/间距/圆角/配色
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Star,
  GitFork,
  AlertCircle,
  Clock,
  Scale,
  Code2,
  RefreshCw,
  Copy,
  Github,
  ChevronDown,
  Calendar,
  History,
  Tag,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import {
  getRepo,
  getReleases,
  getRepoLanguages,
  formatRelativeTime,
} from '@/services/github';
import type { GitHubRelease, GitHubReleaseAsset } from '@/services/github';
import type { GitHubRepo } from '@/types/types';
import { copyToClipboard } from '@/lib/utils';
import i18n from '@/i18n';

/* ---------------- 平台识别 ---------------- */

type PlatformKey = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'tv' | 'other';

const PLATFORM_LABEL: Record<PlatformKey, string> = {
  android: 'Android',
  ios: 'iOS',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  tv: 'TV',
  other: '其他',
};

/** 平台 pill 配色：参照站 Android 为绿，其余按同色系推导 */
const PLATFORM_TONE: Record<PlatformKey, { color: string; bg: string }> = {
  android: { color: 'rgb(61,220,132)', bg: 'rgba(61,220,132,0.13)' },
  ios: { color: 'rgb(22,119,255)', bg: 'rgba(22,119,255,0.11)' },
  windows: { color: 'rgb(22,119,255)', bg: 'rgba(22,119,255,0.11)' },
  macos: { color: 'rgb(120,120,128)', bg: 'rgba(120,120,128,0.12)' },
  linux: { color: 'rgb(255,149,0)', bg: 'rgba(255,149,0,0.12)' },
  tv: { color: 'rgb(175,82,222)', bg: 'rgba(175,82,222,0.12)' },
  other: { color: 'rgb(120,120,128)', bg: 'rgba(120,120,128,0.12)' },
};

/** 按产物文件名推断目标平台 */
function detectPlatform(name: string): PlatformKey {
  const n = name.toLowerCase();
  if (/androidtv|android[_-]?tv/.test(n)) return 'tv';
  if (/\.apk$|\.aab$|\.xapk$|\.apks$/.test(n)) return 'android';
  if (/\.ipa$/.test(n) || /ios/.test(n)) return 'ios';
  if (/\.exe$|\.msi$|\.msix$/.test(n) || /win(dows)?/.test(n)) return 'windows';
  if (/\.dmg$|\.pkg$/.test(n) || /mac(os)?/.test(n)) return 'macos';
  if (/\.deb$|\.rpm$|\.appimage$|\.flatpak$|\.snap$/.test(n) || /linux/.test(n)) return 'linux';
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

/** 统计口径：参照站用 k 缩写（3.1k） */
function shortNumber(n: number): string {
  if (n >= 1000) {
    // 统一保留一位小数（去掉末尾 .0），与参照站 28.7k / 2k 的展示一致
    return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(n);
}

/* ---------------- 参照站样式常量 ---------------- */

const C = {
  pageBg: 'rgb(245,246,248)',
  cardBg: 'rgb(255,255,255)',
  primaryText: 'rgb(26,26,26)',
  secondaryText: 'rgb(136,136,136)',
  tertiaryText: 'rgb(153,153,153)',
  metaText: 'rgb(170,170,170)',
  link: 'rgb(22,119,255)',
  divider: 'rgb(240,240,240)',
} as const;

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

  const primaryLanguage = repo?.language ?? Object.keys(languages)[0] ?? null;
  const licenseText =
    repo?.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
      ? repo.license.spdx_id
      : repo?.license?.name || i18n.t('未知');

  const displayName = repo?.name || repoName;

  const goRealRepo = () => navigate(`/repos/${owner}/${repoName}`);

  /* ---------- 渲染 ---------- */

  if (loading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: C.pageBg }}>
        <div className="mx-auto px-3 pt-3" style={{ maxWidth: 720 }}>
          <Skeleton className="h-[51px] w-full rounded-none" />
          <div className="mt-3 space-y-2.5">
            <Skeleton className="h-[120px] w-full rounded-[18px]" />
            <Skeleton className="h-[200px] w-full rounded-[18px]" />
            <Skeleton className="h-[230px] w-full rounded-[16px]" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !repo) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-6"
        style={{ backgroundColor: C.pageBg }}
      >
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 mx-auto" style={{ color: C.tertiaryText }} />
          <p className="text-[13px]" style={{ color: C.secondaryText }}>
            {error || i18n.t('仓库不存在')}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border text-[13px]"
              style={{ borderColor: C.divider, color: C.primaryText }}
            >
              <RefreshCw className="w-4 h-4" />
              {i18n.t('重试')}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold"
              style={{ backgroundColor: C.primaryText, color: '#fff' }}
            >
              {i18n.t('返回')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: C.pageBg }}>
      {/* 顶部导航条：51px、padding 12px 16px、白底，标题 fs17/fw600 */}
      <header
        className="sticky top-0 z-20 flex items-center"
        style={{
          height: 51,
          padding: '12px 16px',
          backgroundColor: C.cardBg,
          borderBottom: `1px solid ${C.divider}`,
        }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label={i18n.t('返回')}
          className="-ml-1 flex items-center justify-center"
          style={{ width: 22, height: 22, color: C.primaryText }}
        >
          <ArrowLeft className="w-[19px] h-[19px]" strokeWidth={2.2} />
        </button>
        <h1
          className="ml-2 flex-1 truncate"
          style={{
            fontSize: 17,
            fontWeight: 600,
            lineHeight: '22px',
            color: C.primaryText,
          }}
        >
          {displayName}
        </h1>
        <button
          type="button"
          onClick={() => {
            copyToClipboard(repo.html_url);
            toast.success(i18n.t('仓库地址已复制'));
          }}
          aria-label={i18n.t('复制仓库地址')}
          className="ml-2 flex items-center justify-center rounded-full"
          style={{
            width: 30,
            height: 30,
            backgroundColor: C.divider,
            color: C.primaryText,
          }}
        >
          <Copy className="w-[15px] h-[15px]" />
        </button>
      </header>

      {/* 内容区：padding 12px 12px 48px、flex column、gap 14px（拉开各卡片间距） */}
      <div
        className="mx-auto flex flex-col"
        style={{ maxWidth: 720, padding: '12px 12px 48px', gap: 14 }}
      >
        {/* ===== 应用头部卡片：图标 + 名称 + Stats 块 + 简介 + 进入仓库按钮 ===== */}
        <section
          className="flex flex-col"
          style={{
            backgroundColor: C.cardBg,
            borderRadius: 16,
            padding: 16,
            boxShadow: '0 1px 4px rgba(0, 0, 0, 0.07)',
            gap: 12,
          }}
        >
          <div className="flex flex-col" style={{ gap: 12 }}>
            {/* 图标 + 名称 */}
            <div className="flex items-center" style={{ gap: 12 }}>
              <div
                className="shrink-0 overflow-hidden"
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 16,
                  backgroundColor: C.pageBg,
                }}
              >
                {repo.owner?.avatar_url ? (
                  <img
                    src={repo.owner.avatar_url}
                    alt={displayName}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    className="flex items-center justify-center w-full h-full"
                    style={{ fontSize: 24, fontWeight: 700, color: C.secondaryText }}
                  >
                    {displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h2
                  className="truncate"
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    lineHeight: '26px',
                    color: C.primaryText,
                  }}
                >
                  {displayName}
                </h2>
                <button
                  type="button"
                  onClick={goRealRepo}
                  className="truncate max-w-full text-left"
                  style={{
                    fontSize: 12,
                    fontWeight: 400,
                    lineHeight: '16px',
                    color: C.link,
                  }}
                >
                  {repo.full_name}
                </button>
              </div>
            </div>

            {/* Stats：浅灰蓝底整块、br14、三列等分（对齐原版 247,249,252） */}
            <div
              className="flex items-stretch"
              style={{
                backgroundColor: 'rgb(247,249,252)',
                borderRadius: 14,
                gap: 0,
              }}
            >
              <StatItem
                Icon={Star}
                value={shortNumber(repo.stargazers_count)}
                label="Stars"
                color="rgb(255,179,0)"
              />
              <StatDivider />
              <StatItem
                Icon={GitFork}
                value={shortNumber(repo.forks_count)}
                label="Forks"
                color="rgb(0,185,107)"
              />
              <StatDivider />
              <StatItem
                Icon={Code2}
                value={primaryLanguage || '-'}
                label={i18n.t('语言')}
                color="rgb(22,119,255)"
              />
            </div>

            {/* 简介 */}
            {repo.description && (
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  lineHeight: '18px',
                  color: 'rgb(102,102,102)',
                }}
              >
                {repo.description}
              </p>
            )}
          </div>
        </section>

        {/* ===== 进入仓库：独立按钮，不套卡片容器 ===== */}
        <button
          type="button"
          onClick={() => navigate(`/repos/${repo.full_name}`)}
          className="w-full flex items-center justify-center"
          style={{
            height: 50,
            borderRadius: 14,
            backgroundColor: C.primaryText,
            padding: '14px 0',
            gap: 8,
            fontSize: 15,
            fontWeight: 700,
            lineHeight: '18px',
            color: '#fff',
          }}
        >
          <Github className="w-[20px] h-[20px] shrink-0" />
          {i18n.t('进入仓库')}
        </button>

        {/* ===== 下载区：最新版本产物，按产物平铺 ===== */}
        <section
          id="release-assets"
          className="flex flex-col"
          style={{ backgroundColor: C.cardBg, borderRadius: 18, overflow: 'hidden' }}
        >
          {/* 最新版本横条：作为下载卡首行（原版该信息就位于产物下载区内） */}
          {latestRelease && (
            <div
              className="flex items-center text-left"
              style={{
                padding: '14px 16px',
                gap: 8,
                borderBottom: `1px solid ${C.divider}`,
              }}
            >
              <Tag className="w-[14px] h-[14px] shrink-0" style={{ color: C.tertiaryText }} />
              <span
                className="flex-1 truncate"
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  lineHeight: '18px',
                  color: C.primaryText,
                }}
              >
                {i18n.t('最新版本')} {latestRelease.tag_name}
              </span>
              <span
                className="shrink-0"
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: '16px',
                  color: C.tertiaryText,
                }}
              >
                {formatDate(latestRelease.published_at)}
              </span>
            </div>
          )}

          {assets.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  lineHeight: '18px',
                  color: C.tertiaryText,
                }}
              >
                {i18n.t('该项目暂无 Release 产物')}
              </p>
            </div>
          ) : (
            assets.map((asset, idx) => {
              const platform = detectPlatform(asset.name);
              return (
                <div
                  key={asset.id}
                  className="flex items-center"
                  style={{
                    padding: '12px 16px',
                    gap: 10,
                    borderTop: idx === 0 ? 'none' : `1px solid ${C.divider}`,
                  }}
                >
                  {/* 左列：平台 pill（独立成列，垂直居中） */}
                  <PlatformPill platform={platform} />
                  {/* 中列：文件名 + 体积/下载量（名称过长换行，不截断） */}
                  <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 2 }}>
                    <p
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: '18px',
                        color: C.primaryText,
                        whiteSpace: 'normal',
                        wordBreak: 'break-all',
                      }}
                    >
                      {asset.name}
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 400,
                        lineHeight: '15px',
                        color: C.metaText,
                        whiteSpace: 'normal',
                        wordBreak: 'break-all',
                      }}
                    >
                      {formatSize(asset.size)},{' '}
                      {asset.download_count.toLocaleString('en-US')}
                      {i18n.t('次下载')}
                    </p>
                  </div>
                  {/* 右列：下载按钮，带描边 */}
                  <a
                    href={asset.browser_download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      lineHeight: '15px',
                      color: C.link,
                      padding: '8px 16px',
                      borderRadius: 20,
                      border: `1px solid ${C.link}`,
                    }}
                  >
                    {i18n.t('下载')}
                  </a>
                </div>
              );
            })
          )}

          {/* 历史版本：卡内分割行，非独立卡片 */}
          {historyReleases.map((release, idx) => {
            const expanded = expandedReleases.includes(release.id);
            const versionAssets = release.assets ?? [];
            return (
              <div key={release.id}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedReleases((prev) =>
                      prev.includes(release.id)
                        ? prev.filter((id) => id !== release.id)
                        : [...prev, release.id],
                    )
                  }
                  className="w-full flex items-center text-left"
                  style={{
                    padding: '14px 16px',
                    gap: 8,
                    borderTop:
                      idx === 0 && assets.length === 0 ? 'none' : `1px solid ${C.divider}`,
                  }}
                >
                  <History
                    className="w-[14px] h-[14px] shrink-0"
                    style={{ color: C.tertiaryText }}
                  />
                  <span
                    className="flex-1 truncate"
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      lineHeight: '16px',
                      color: C.primaryText,
                    }}
                  >
                    {i18n.t('历史版本')} {release.tag_name}
                  </span>
                  <span
                    className="shrink-0"
                    style={{
                      fontSize: 12,
                      fontWeight: 400,
                      lineHeight: '16px',
                      color: C.tertiaryText,
                    }}
                  >
                    {formatDate(release.published_at)}
                  </span>
                  <ChevronDown
                    className="w-[14px] h-[14px] shrink-0 transition-transform"
                    style={{
                      color: C.tertiaryText,
                      transform: expanded ? 'rotate(180deg)' : 'none',
                    }}
                  />
                </button>

                {expanded && (
                  <div style={{ backgroundColor: C.pageBg }}>
                    {versionAssets.length === 0 ? (
                      <p
                        style={{
                          padding: '12px 16px',
                          fontSize: 12,
                          fontWeight: 400,
                          lineHeight: '16px',
                          color: C.tertiaryText,
                        }}
                      >
                        {i18n.t('该版本暂无产物')}
                      </p>
                    ) : (
                      versionAssets.map((asset) => (
                        <div
                          key={asset.id}
                          className="flex items-center"
                          style={{
                            padding: '10px 16px 10px 38px',
                            gap: 10,
                            borderTop: `1px solid ${C.divider}`,
                          }}
                        >
                          <div className="flex-1 min-w-0 flex flex-col" style={{ gap: 2 }}>
                            <p
                              className="truncate"
                              style={{
                                fontSize: 12,
                                fontWeight: 500,
                                lineHeight: '15px',
                                color: C.primaryText,
                              }}
                            >
                              {asset.name}
                            </p>
                            <p
                              className="truncate"
                              style={{
                                fontSize: 11,
                                fontWeight: 400,
                                lineHeight: '14px',
                                color: C.metaText,
                              }}
                            >
                              {formatSize(asset.size)},{' '}
                              {asset.download_count.toLocaleString('en-US')}
                              {i18n.t('次下载')}
                            </p>
                          </div>
                          <a
                            href={asset.browser_download_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0"
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: '15px',
                              color: C.link,
                              padding: '6px 12px',
                              borderRadius: 16,
                              border: `1px solid ${C.link}`,
                            }}
                          >
                            {i18n.t('下载')}
                          </a>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
        {/* ===== 项目信息 ===== */}
        <section
          className="flex flex-col"
          style={{ backgroundColor: C.cardBg, borderRadius: 16, padding: 16, gap: 10 }}
        >
          <h2
            style={{
              fontSize: 15,
              fontWeight: 700,
              lineHeight: '20px',
              color: C.primaryText,
            }}
          >
            {i18n.t('项目信息')}
          </h2>

          <InfoRow Icon={Scale} label={i18n.t('许可证')} value={licenseText} />
          <InfoRow
            Icon={Clock}
            label={i18n.t('最近更新')}
            value={formatRelativeTime(repo.pushed_at || repo.updated_at)}
          />
          <InfoRow Icon={Code2} label={i18n.t('最新版本')} value={latestRelease?.tag_name || '—'} />
          {latestRelease?.published_at && (
            <InfoRow
              Icon={Calendar}
              label={i18n.t('发布时间')}
              value={formatDate(latestRelease.published_at)}
            />
          )}

          {/* 安全提示：并入项目信息卡片，弱化色，与上方信息行用分隔线区隔 */}
          <div
            className="flex items-start"
            style={{
              gap: 10,
              paddingTop: 10,
              borderTop: `1px solid ${C.divider}`,
            }}
          >
            <AlertCircle
              className="w-[14px] h-[14px] shrink-0"
              style={{ color: C.metaText, marginTop: 1 }}
            />
            <p
              style={{
                fontSize: 11,
                fontWeight: 400,
                lineHeight: '16px',
                color: C.metaText,
              }}
            >
              {i18n.t('安装包来自 GitHub Release，请确认来源可信后再安装，建议仅安装您熟悉的开源项目。')}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------------- 子组件 ---------------- */

/** Stats 分隔竖线：1px、上下留白、浅灰蓝（与块底色区分） */
function StatDivider() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        alignSelf: 'stretch',
        margin: '14px 0',
        backgroundColor: 'rgb(229,232,238)',
        flex: '0 0 1px',
      }}
    />
  );
}

/** Stats 单项：图标 + 数值(fs17/700) + 标签(fs12) */
function StatItem({
  Icon,
  value,
  label,
  color,
}: {
  Icon: typeof Star;
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div
      className="flex flex-col items-center"
      style={{ gap: 4, flex: '1 1 0%', minWidth: 0, padding: '14px 0' }}
    >
      <Icon className="w-[20px] h-[20px]" style={{ color }} />
      <span
        className="truncate max-w-full"
        style={{
          fontSize: 17,
          fontWeight: 700,
          lineHeight: '20px',
          color: C.primaryText,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 400,
          lineHeight: '14px',
          color: C.tertiaryText,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** 平台 pill：fs12/500、lh16、bd6、pad 3px 6px */
function PlatformPill({
  platform,
  style,
}: {
  platform: PlatformKey;
  style?: React.CSSProperties;
}) {
  const tone = PLATFORM_TONE[platform];
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '13px',
        color: tone.color,
        backgroundColor: tone.bg,
        borderRadius: 6,
        padding: '3px 6px',
        ...style,
      }}
    >
      {PLATFORM_LABEL[platform]}
    </span>
  );
}

/** 项目信息行：图标 + 标签(fs13/灰) + 值(fs13/深) */
function InfoRow({
  Icon,
  label,
  value,
}: {
  Icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center" style={{ gap: 10 }}>
      <Icon className="w-[14px] h-[14px] shrink-0" style={{ color: C.tertiaryText }} />
      <span
        className="shrink-0"
        style={{ fontSize: 13, fontWeight: 400, lineHeight: '18px', color: C.secondaryText }}
      >
        {label}
      </span>
      <span
        className="flex-1 truncate text-right"
        style={{ fontSize: 13, fontWeight: 400, lineHeight: '18px', color: C.primaryText }}
      >
        {value}
      </span>
    </div>
  );
}
