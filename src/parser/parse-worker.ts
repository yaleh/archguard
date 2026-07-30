import { parentPort, workerData } from 'node:worker_threads';
import { TypeScriptParser } from './typescript-parser.js';
import { resolveParserBackend } from '@/plugins/shared/parser-backend.js';
import type { ArchJSON } from '@/types/index.js';
import type { ParseJob, ParseResult, ParseWorkerInitData } from './parse-worker-pool.js';

const initData = workerData as ParseWorkerInitData;

type WorkerParser = {
  parseCode(code: string, filePath: string): ArchJSON;
  dispose?: () => void;
};

async function createParser(): Promise<WorkerParser> {
  if (initData.language === 'typescript') return new TypeScriptParser(initData.workspaceRoot);
  const backend = await resolveParserBackend(initData.runtime);
  const module =
    initData.language === 'go'
      ? await import('@/plugins/golang/index.js')
      : initData.language === 'java'
        ? await import('@/plugins/java/index.js')
        : initData.language === 'python'
          ? await import('@/plugins/python/index.js')
          : initData.language === 'cpp'
            ? await import('@/plugins/cpp/index.js')
            : await import('@/plugins/kotlin/index.js');
  const Plugin =
    'GoPlugin' in module
      ? module.GoPlugin
      : 'JavaPlugin' in module
        ? module.JavaPlugin
        : 'PythonPlugin' in module
          ? module.PythonPlugin
          : 'CppPlugin' in module
            ? module.CppPlugin
            : module.KotlinPlugin;
  const plugin = new Plugin(backend);
  await plugin.initialize({ workspaceRoot: initData.workspaceRoot ?? process.cwd() });
  return plugin;
}

// Each worker owns exactly one parser session. Runtime selection happened in
// the parent and is propagated unchanged; no worker may independently select.
const parserPromise = createParser();

parentPort?.once('close', () => {
  void parserPromise.then((parser) => parser.dispose?.());
});

parentPort?.on('message', (job: ParseJob) => {
  void parserPromise
    .then((parser) => {
      let result: ParseResult;
      try {
        result = {
          jobId: job.jobId,
          success: true,
          archJson: parser.parseCode(job.code, job.filePath),
        };
      } catch (error) {
        result = {
          jobId: job.jobId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      parentPort?.postMessage(result);
    })
    .catch((error: unknown) => {
      parentPort?.postMessage({
        jobId: job.jobId,
        success: false,
        error: `Parser initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      } satisfies ParseResult);
    });
});
