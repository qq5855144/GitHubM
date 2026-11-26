import { createDirectoryArchive, type ArchiveCommand, type ArchiveReply } from './directoryArchive';

const execute = createDirectoryArchive(true);
self.onmessage = ({ data }: MessageEvent<ArchiveCommand>) => {
  try {
    const chunks = execute(data);
    const transfers = [...new Set(chunks.map(chunk => chunk.buffer))];
    self.postMessage({ chunks } satisfies ArchiveReply, { transfer: transfers });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies ArchiveReply);
  }
};
