// 复制按钮：memo 优化，防止父组件渲染时重复挂载
import { memo, useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  text: string;
}

const CopyButton = memo(function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="复制内容"
    >
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-500" />
        : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
});

export default CopyButton;
