// 新建仓库页面

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Loader2, Plus, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createRepo, getGitignoreTemplates, getLicenses } from '@/services/github';
import { pageCache } from '@/lib/page-cache';
import { toast } from 'sonner';
import i18n from '@/i18n';

export default function NewRepoPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [autoInit, setAutoInit] = useState(true);
  const [gitignore, setGitignore] = useState('');
  const [license, setLicense] = useState('');
  const [gitignoreTemplates, setGitignoreTemplates] = useState<string[]>([]);
  const [licenses, setLicenses] = useState<Array<{ key: string; name: string }>>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([getGitignoreTemplates(), getLicenses()])
      .then(([templates, licenseList]) => {
        setGitignoreTemplates(templates);
        setLicenses(licenseList);
      })
      .catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error(i18n.t('请输入仓库名称'));
      return;
    }
    setCreating(true);
    try {
      const repo = await createRepo({
        name: name.trim(),
        description: description.trim() || undefined,
        private: isPrivate,
        auto_init: autoInit,
        gitignore_template: gitignore || undefined,
        license_template: license || undefined,
      });
      pageCache.invalidate('repos:');
      toast.success(`${i18n.t('仓库创建成功')}：${repo.full_name}`);
      navigate(`/repos/${repo.full_name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('创建仓库失败'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">{i18n.t('新建仓库')}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <BookOpen className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">{i18n.t('创建新仓库')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{i18n.t('填写仓库信息后直接创建')}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-5">
        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">{i18n.t('仓库名称 *')}</Label>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="my-awesome-project"
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">{i18n.t('描述（可选）')}</Label>
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={i18n.t('项目简介...')}
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none"
            rows={3}
          />
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-secondary/20 p-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-normal text-foreground">{i18n.t('私有仓库')}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{i18n.t('只有您有权访问此仓库')}</p>
            </div>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-normal text-foreground">{i18n.t('初始化 README')}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{i18n.t('自动创建 README 文件')}</p>
            </div>
            <Switch checked={autoInit} onCheckedChange={setAutoInit} />
          </div>
        </div>

        {autoInit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">{i18n.t('.gitignore 模板')}</Label>
              <Select value={gitignore || 'none'} onValueChange={(value) => setGitignore(value === 'none' ? '' : value)}>
                <SelectTrigger className="bg-secondary border-border text-foreground h-9">
                  <SelectValue placeholder={i18n.t('选择模板')} />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border max-h-60">
                  <SelectItem value="none" className="text-foreground">{i18n.t('无')}</SelectItem>
                  {gitignoreTemplates.map((template) => (
                    <SelectItem key={template} value={template} className="text-foreground">{template}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">{i18n.t('许可证')}</Label>
              <Select value={license || 'none'} onValueChange={(value) => setLicense(value === 'none' ? '' : value)}>
                <SelectTrigger className="bg-secondary border-border text-foreground h-9">
                  <SelectValue placeholder={i18n.t('选择许可证')} />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border max-h-60">
                  <SelectItem value="none" className="text-foreground">{i18n.t('无')}</SelectItem>
                  {licenses.map((item) => (
                    <SelectItem key={item.key} value={item.key} className="text-foreground">{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <Button
            type="button"
            variant="outline"
            className="sm:flex-1 border-border hover:bg-secondary"
            onClick={() => navigate('/repos')}
            disabled={creating}
          >
            {i18n.t('取消')}
          </Button>
          <Button
            type="button"
            className="sm:flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleCreate}
            disabled={creating || !name.trim()}
          >
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            {creating ? i18n.t('创建中...') : i18n.t('创建仓库')}
          </Button>
        </div>
      </div>
    </div>
  );
}
