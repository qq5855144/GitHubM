import ZipWorker from './directoryArchive.worker?worker&inline';
import { createDirectoryArchive, type ArchiveCommand, type ArchiveReply } from './directoryArchive';

export function checkDownloadSignal(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

export async function openDirectoryArchive(signal: AbortSignal) {
  checkDownloadSignal(signal);
  let worker: Worker | undefined;
  try {
    worker = new ZipWorker();
    const active = worker;
    const send = (command: ArchiveCommand): Promise<Uint8Array<ArrayBuffer>[]> => new Promise((resolve, reject) => {
      checkDownloadSignal(signal);
      const clear = () => {
        signal.removeEventListener('abort', abort);
        window.clearTimeout(timeout);
        active.onmessage = null;
        active.onerror = null;
      };
      const abort = () => {
        clear();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timeout = command.type === 'ready' ? window.setTimeout(() => {
        clear();
        reject(new Error('ZIP Worker 启动超时'));
      }, 3000) : 0;
      active.onmessage = ({ data }: MessageEvent<ArchiveReply>) => {
        clear();
        if ('error' in data) reject(new Error(data.error));
        else resolve(data.chunks);
      };
      active.onerror = (event) => {
        event.preventDefault();
        clear();
        reject(new Error('ZIP Worker 无法运行'));
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        active.postMessage(command, command.type === 'data' ? [command.bytes.buffer] : []);
      } catch (error) {
        clear();
        reject(error);
      }
    });
    await send({ type: 'ready' });
    return { send, close: () => active.terminate() };
  } catch {
    worker?.terminate();
    checkDownloadSignal(signal);
    const execute = createDirectoryArchive(false);
    return {
      send: async (command: ArchiveCommand) => {
        // Worker 不可用时用无压缩 ZIP，小块处理并让出事件循环。
        if (command.type === 'data' && command.bytes.byteLength >= 64 * 1024) {
          await new Promise<void>(resolve => window.setTimeout(resolve, 0));
        }
        checkDownloadSignal(signal);
        return execute(command);
      },
      close: () => {},
    };
  }
}
