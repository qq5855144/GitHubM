// 分支选择器：memo 优化，分支列表不变时不重渲染
import { memo } from 'react';
import { GitBranch, ChevronDown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import i18n from "@/i18n";

interface BranchPickerProps {
  branches: string[];
  value: string;
  onChange: (branch: string) => void;
  loading: boolean;
}

const BranchPicker = memo(function BranchPicker({
  branches,
  value,
  onChange,
  loading,
}: BranchPickerProps) {
  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={loading || branches.length === 0}
    >
      {/*
        用 [&>svg]:hidden 隐藏 shadcn SelectTrigger 内置的 ChevronDown，
        避免与我们自定义的图标重复渲染（也是引发布局异常的根源）。
      */}
      <SelectTrigger className="h-7 px-2 text-xs border-border bg-muted/40 hover:bg-muted min-w-0 max-w-[160px] [&>svg]:hidden">
        <div className="flex items-center gap-1 min-w-0">
          <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
          <span className="truncate font-medium font-mono">
            {loading ? i18n.t('加载中…') : (value || i18n.t('选择分支'))}
          </span>
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        </div>
      </SelectTrigger>
      <SelectContent className="max-h-48">
        {branches.map(b => (
          <SelectItem key={b} value={b}>
            <span className="font-mono text-xs">{b}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
});

export default BranchPicker;
