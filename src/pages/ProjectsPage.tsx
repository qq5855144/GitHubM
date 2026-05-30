// GitHub Projects 经典看板管理

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  LayoutDashboard,
  Plus,
  Trash2,
  X,
  Save,
  AlertCircle,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  getRepoProjects,
  getProjectColumns,
  getColumnCards,
  createProject,
  deleteProject,
  createProjectColumn,
  createProjectCard,
  formatRelativeTime,
} from '@/services/github';
import type { GitHubProject, GitHubProjectColumn, GitHubProjectCard } from '@/types/types';
import { toast } from 'sonner';
import i18n from "@/i18n";

function KanbanColumn({
  column,
  onAddCard,
}: {
  column: GitHubProjectColumn & { cards: GitHubProjectCard[] };
  onAddCard: (columnId: number, note: string) => Promise<void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!note.trim()) return;
    setAdding(true);
    try {
      await onAddCard(column.id, note.trim());
      setNote('');
      setAddOpen(false);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="bg-secondary/50 border border-border rounded-lg overflow-hidden min-w-60 flex flex-col">
      <div className="px-3 py-2.5 border-b border-border bg-secondary/80 flex items-center gap-2">
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1 min-w-0 truncate">{column.name}</span>
        <Badge variant="outline" className="text-xs border-border text-muted-foreground">{column.cards.length}</Badge>
      </div>
      <div className="flex-1 p-2 space-y-2 min-h-20">
        {column.cards.map((card) => (
          <div key={card.id} className="bg-card border border-border rounded p-2.5 group hover:border-primary/50 transition-colors">
            <p className="text-xs text-foreground leading-relaxed text-pretty">{card.note || i18n.t('（关联 Issue/PR）')}</p>
            <p className="text-xs text-muted-foreground mt-1">{formatRelativeTime(card.updated_at)}</p>
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-border">
        {addOpen ? (
          <div className="space-y-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={i18n.t('输入卡片内容...')}
              className="bg-card border-border text-foreground text-xs min-h-16 resize-none placeholder:text-muted-foreground"
              autoFocus
            />
            <div className="flex gap-1.5">
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 text-xs" onClick={handleAdd} disabled={adding || !note.trim()}>
                {adding ? i18n.t('添加中...') : i18n.t('添加')}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-muted-foreground hover:bg-secondary text-xs" onClick={() => { setAddOpen(false); setNote(''); }}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground hover:bg-secondary h-7 text-xs justify-start" onClick={() => setAddOpen(true)}>
            <Plus className="w-3 h-3 mr-1" />{i18n.t('添加卡片')}</Button>
        )}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<GitHubProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<GitHubProject | null>(null);
  const [columns, setColumns] = useState<Array<GitHubProjectColumn & { cards: GitHubProjectCard[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [addColName, setAddColName] = useState('');
  const [addingCol, setAddingCol] = useState(false);
  const [addColOpen, setAddColOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!owner || !repo) return;
    getRepoProjects(owner, repo)
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => { toast.error(i18n.t('加载项目列表失败（可能需要启用 Projects 功能）')); console.error(err); })
      .finally(() => setLoading(false));
  }, [owner, repo]);

  const loadBoard = useCallback(async (project: GitHubProject) => {
    setSelectedProject(project);
    setLoadingBoard(true);
    try {
      const cols = await getProjectColumns(project.id);
      const colsWithCards = await Promise.all(
        cols.map(async (col) => {
          const cards = await getColumnCards(col.id).catch(() => []);
          return { ...col, cards };
        })
      );
      setColumns(colsWithCards);
    } catch (err) {
      toast.error(i18n.t('加载看板失败'));
      console.error(err);
    } finally {
      setLoadingBoard(false);
    }
  }, []);

  const handleCreateProject = async () => {
    if (!owner || !repo || !newName.trim()) return;
    setCreating(true);
    try {
      const proj = await createProject(owner, repo, newName.trim(), newBody.trim() || undefined);
      setProjects((prev) => [proj, ...prev]);
      toast.success(i18n.t('项目看板已创建'));
      setCreateOpen(false);
      setNewName(''); setNewBody('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('创建失败'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget));
      if (selectedProject?.id === deleteTarget) { setSelectedProject(null); setColumns([]); }
      toast.success(i18n.t('项目已删除'));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('删除失败'));
    } finally {
      setDeleting(false);
    }
  };

  const handleAddColumn = async () => {
    if (!selectedProject || !addColName.trim()) return;
    setAddingCol(true);
    try {
      const col = await createProjectColumn(selectedProject.id, addColName.trim());
      setColumns((prev) => [...prev, { ...col, cards: [] }]);
      setAddColName('');
      setAddColOpen(false);
      toast.success(i18n.t('列已添加'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('添加列失败'));
    } finally {
      setAddingCol(false);
    }
  };

  const handleAddCard = async (columnId: number, note: string) => {
    try {
      const card = await createProjectCard(columnId, note);
      setColumns((prev) => prev.map((col) =>
        col.id === columnId ? { ...col, cards: [...col.cards, card] } : col
      ));
      toast.success(i18n.t('卡片已添加'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('添加卡片失败'));
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Projects</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          {i18n.t('项目看板')}</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" />{i18n.t('新建看板')}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
            <DialogHeader><DialogTitle className="text-foreground">{i18n.t('创建项目看板')}</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">{i18n.t('看板名称 *')}</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={i18n.t('项目名称...')} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">{i18n.t('描述（可选）')}</Label>
                <Textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder={i18n.t('描述...')} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none min-h-16" />
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="ghost" className="flex-1 border border-border text-muted-foreground hover:bg-secondary" onClick={() => setCreateOpen(false)}><X className="w-4 h-4 mr-2" />{i18n.t('取消')}</Button>
                <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleCreateProject} disabled={creating || !newName.trim()}><Save className="w-4 h-4 mr-2" />{creating ? i18n.t('创建中...') : i18n.t('创建')}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
        {/* 项目列表 */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-secondary/30">
            <p className="text-sm font-medium text-foreground">{i18n.t('项目列表')}</p>
          </div>
          {loading ? (
            <div className="p-3 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 bg-muted" />)}</div>
          ) : projects.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground px-4">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              {i18n.t('暂无项目看板')}</div>
          ) : (
            <div className="divide-y divide-border">
              {projects.map((proj) => (
                <div key={proj.id} className={`flex items-center gap-2 px-3 py-2.5 group cursor-pointer hover:bg-secondary/50 transition-colors ${selectedProject?.id === proj.id ? 'bg-primary/10' : ''}`} onClick={() => loadBoard(proj)}>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${selectedProject?.id === proj.id ? 'text-primary' : 'text-foreground'}`}>{proj.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className={`text-xs ${proj.state === 'open' ? 'border-success/40 text-success' : 'border-border text-muted-foreground'}`}>
                        {proj.state === 'open' ? i18n.t('进行中') : i18n.t('已关闭')}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(proj.id); }}
                    title={i18n.t('删除')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 看板主体 */}
        <div className="md:col-span-3">
          {!selectedProject ? (
            <div className="bg-card border border-border rounded-lg py-16 text-center">
              <LayoutDashboard className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-foreground font-medium">{i18n.t('选择一个项目看板')}</p>
            </div>
          ) : loadingBoard ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {[1,2,3].map(i => <Skeleton key={i} className="min-w-60 h-48 bg-muted rounded-lg" />)}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-base font-semibold text-foreground">{selectedProject.name}</h2>
                <Badge variant="outline" className={`text-xs ${selectedProject.state === 'open' ? 'border-success/40 text-success' : 'border-border text-muted-foreground'}`}>
                  {selectedProject.state === 'open' ? i18n.t('进行中') : i18n.t('已关闭')}
                </Badge>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-3">
                {columns.map((col) => (
                  <KanbanColumn key={col.id} column={col} onAddCard={handleAddCard} />
                ))}
                {/* 添加列 */}
                <div className="min-w-60 shrink-0">
                  {addColOpen ? (
                    <div className="bg-secondary/50 border border-border rounded-lg p-3 space-y-2">
                      <Input
                        value={addColName}
                        onChange={(e) => setAddColName(e.target.value)}
                        placeholder={i18n.t('列名称...')}
                        className="bg-card border-border text-foreground placeholder:text-muted-foreground text-sm"
                        autoFocus
                      />
                      <div className="flex gap-1.5">
                        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 h-7 text-xs" onClick={handleAddColumn} disabled={addingCol || !addColName.trim()}>
                          {addingCol ? i18n.t('添加中...') : i18n.t('添加列')}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-muted-foreground hover:bg-secondary text-xs" onClick={() => { setAddColOpen(false); setAddColName(''); }}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="w-full min-h-16 border-2 border-dashed border-border rounded-lg flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                      onClick={() => setAddColOpen(true)}
                    >
                      <Plus className="w-4 h-4" />{i18n.t('添加列')}</button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('确认删除项目')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">{i18n.t('此操作不可撤销，项目及所有卡片将被永久删除。')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteProject} disabled={deleting}>{deleting ? i18n.t('删除中...') : i18n.t('确认删除')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
