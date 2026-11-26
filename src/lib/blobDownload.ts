function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : '');
    };
    reader.onerror = () => reject(reader.error || new Error('读取下载内容失败'));
    reader.readAsDataURL(blob);
  });
}

export async function triggerBlobDownload(blob: Blob, filename: string): Promise<void> {
  // Android WebView 中不要用 blob: URL + <a download>：
  // DownloadListener 回调是异步的，旧实现立即 revokeObjectURL 会让原生
  // 再次 fetch 时拿不到内容，最终触发 saveBlobData 的“内容为空”。
  const bridge = (window as unknown as {
    AndroidBridge?: { saveBlobData?: (f: string, m: string, b: string) => void }
  }).AndroidBridge;
  if (bridge?.saveBlobData) {
    const base64 = await blobToBase64(blob);
    if (!base64) throw new Error('生成下载内容失败');
    bridge.saveBlobData(filename, blob.type || 'application/octet-stream', base64);
    return;
  }

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟释放，兼容仍依赖 blob URL 的 WebView 下载兜底。
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

interface DownloadSink {
  write: (chunk: Uint8Array<ArrayBuffer>) => Promise<void>;
  finish: () => Promise<void>;
  abort: () => Promise<void>;
}

interface ChunkedAndroidDownload {
  startBlobDownload: (name: string, mime: string) => string;
  appendBlobDownload: (id: string, base64: string) => string;
  finishBlobDownload: (id: string) => string;
  cancelBlobDownload: (id: string) => void;
}

interface SaveFilePicker {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Uint8Array<ArrayBuffer>) => Promise<void>;
      close: () => Promise<void>;
      abort: () => Promise<void>;
    }>;
  }>;
}

export async function openDownloadSink(filename: string, mime: string): Promise<DownloadSink> {
  const host = window as Window & SaveFilePicker & { AndroidBridge?: Partial<ChunkedAndroidDownload> };
  const bridge = host.AndroidBridge;
  if (bridge?.startBlobDownload && bridge.appendBlobDownload && bridge.finishBlobDownload && bridge.cancelBlobDownload) {
    const id = bridge.startBlobDownload(filename, mime);
    if (id.startsWith('error:')) throw new Error(id.slice(6));
    const check = (error: string) => { if (error) throw new Error(error); };
    return {
      write: async chunk => {
        for (let offset = 0; offset < chunk.length; offset += 256 * 1024) {
          const part = new Blob([chunk.subarray(offset, offset + 256 * 1024)], { type: mime });
          check(bridge.appendBlobDownload!(id, await blobToBase64(part)));
        }
      },
      finish: async () => { check(bridge.finishBlobDownload!(id)); },
      abort: async () => { bridge.cancelBlobDownload!(id); },
    };
  }

  if (!bridge && host.showSaveFilePicker && navigator.userActivation?.isActive) {
    try {
      const file = await host.showSaveFilePicker({ suggestedName: filename });
      const output = await file.createWritable();
      return {
        write: chunk => output.write(chunk),
        finish: () => output.close(),
        abort: () => output.abort(),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name !== 'SecurityError' && error.name !== 'NotSupportedError') throw error;
    }
  }

  const parts: BlobPart[] = [];
  return {
    write: async chunk => { parts.push(chunk); },
    finish: async () => {
      const blob = new Blob(parts, { type: mime });
      parts.length = 0;
      await triggerBlobDownload(blob, filename);
    },
    abort: async () => { parts.length = 0; },
  };
}
