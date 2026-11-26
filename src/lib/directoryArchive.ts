import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

export type ArchiveCommand =
  | { type: 'start'; filename: string }
  | { type: 'data'; bytes: Uint8Array<ArrayBuffer>; final: boolean }
  | { type: 'finish' }
  | { type: 'ready' };

export type ArchiveReply = { chunks: Uint8Array<ArrayBuffer>[] } | { error: string };

export function createDirectoryArchive(compress: boolean) {
  let parts: Uint8Array<ArrayBuffer>[] = [];
  let file: ZipDeflate | ZipPassThrough | undefined;
  const archive = new Zip((error, bytes) => {
    if (error) throw error;
    parts.push(bytes as Uint8Array<ArrayBuffer>);
  });

  return (command: ArchiveCommand): Uint8Array<ArrayBuffer>[] => {
    parts = [];
    switch (command.type) {
      case 'start':
        file = compress
          ? new ZipDeflate(command.filename, { level: 6 })
          : new ZipPassThrough(command.filename);
        archive.add(file);
        break;
      case 'data':
        if (!file) throw new Error('没有正在打包的文件');
        file.push(command.bytes, command.final);
        if (command.final) file = undefined;
        break;
      case 'finish':
        archive.end();
        break;
    }
    return parts;
  };
}
