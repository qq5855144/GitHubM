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
