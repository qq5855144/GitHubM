// GitHub Packages 包管理

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Package2,
  Trash2,
  Tag,
  Clock,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  getUserPackages,
  getPackageVersions,
  deletePackageVersion,
  formatRelativeTime,
} from '@/services/github';
import type { GitHubPackage, GitHubPackageVersion } from '@/types/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import i18n from "@/i18n";

const PACKAGE_TYPES = ['npm', 'maven', 'rubygems', 'docker', 'nuget', 'container'];

function PackageItem({ pkg, username }: { pkg: GitHubPackage; username: string }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<GitHubPackageVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadVersions = async () => {
    if (versions.length > 0) return;
    setLoadingVersions(true);
    try {
      const data = await getPackageVersions(pkg.package_type, pkg.name, username);
      setVersions(data);
    } catch (err) {
      toast.error(i18n.t('加载版本列表失败'));
      console.error(err);
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleOpen = (val: boolean) => {
    setOpen(val);
    if (val) loadVersions();
  };

  const handleDeleteVersion = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePackageVersion(pkg.package_type, pkg.name, username, deleteTarget);
      setVersions((prev) => prev.filter((v) => v.id !== deleteTarget));
      toast.success(i18n.t('版本已删除'));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('删除失败'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Collapsible open={open} onOpenChange={handleOpen}>
        <CollapsibleTrigger className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/50 transition-colors text-left group">
          <Package2 className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-mono font-medium text-foreground">{pkg.name}</span>
              <Badge variant="outline" className="text-xs border-border text-muted-foreground">{pkg.package_type}</Badge>
              <Badge variant="outline" className={`text-xs ${pkg.visibility === 'public' ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}>
                {pkg.visibility === 'public' ? i18n.t('公开') : i18n.t('私密')}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{pkg.version_count} {i18n.t('个版本')}</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(pkg.updated_at)}</span>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border bg-secondary/20">
            {loadingVersions ? (
              <div className="p-3 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-8 bg-muted" />)}</div>
            ) : versions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{i18n.t('暂无版本数据')}</div>
            ) : (
              <div className="divide-y divide-border">
                {versions.map((ver) => (
                  <div key={ver.id} className="flex items-center gap-3 px-6 py-2.5 group/ver hover:bg-secondary/50">
                    <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono text-foreground">{ver.name}</span>
                      {ver.metadata?.container?.tags && ver.metadata.container.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5 flex-wrap">
                          {ver.metadata.container.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs border-border text-muted-foreground">{tag}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{formatRelativeTime(ver.created_at)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 opacity-0 group-hover/ver:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(ver.id)}
                      title={i18n.t('删除版本')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('确认删除版本')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">{i18n.t('此操作不可撤销，该版本将被永久删除。')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteVersion} disabled={deleting}>
              {deleting ? i18n.t('删除中...') : i18n.t('确认删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function PackagesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { owner, repo } = useParams<{ owner?: string; repo?: string }>();
  const [packages, setPackages] = useState<GitHubPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [packageType, setPackageType] = useState<string>('container');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getUserPackages(user.login, packageType)
      .then((data) => setPackages(Array.isArray(data) ? data : []))
      .catch((err) => { toast.error(i18n.t('加载包列表失败')); console.error(err); })
      .finally(() => setLoading(false));
  }, [user, packageType]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {owner && repo && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
          <ChevronRight className="w-3 h-3" />
          <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground">Packages</span>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Package2 className="w-5 h-5 text-primary" />
          {i18n.t('Packages 包管理')}</h1>
        <Select value={packageType} onValueChange={setPackageType}>
          <SelectTrigger className="bg-secondary border-border text-foreground w-36 h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            {PACKAGE_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="text-foreground text-sm">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1,2,3].map(i => (
              <div key={i} className="p-4 flex gap-3">
                <Skeleton className="w-8 h-8 rounded bg-muted" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3 bg-muted" />
                  <Skeleton className="h-3 w-1/4 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : packages.length === 0 ? (
          <div className="py-16 text-center">
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">{i18n.t('未找到')}{packageType} {i18n.t('类型的包')}</p>
            <p className="text-sm text-muted-foreground mt-1">{i18n.t('请尝试切换包类型或发布新包')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {packages.map((pkg) => (
              <PackageItem key={pkg.id} pkg={pkg} username={user?.login || ''} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
