import type { ModuleInfo } from './go-mod-resolver.js';
import type { GoRawData, GoRawPackage, GoMethod } from '../types.js';
import type { DetectedFrameworks } from './types.js';

// Built-in go.mod module-path → framework key mapping (Layer 1)
const GO_MOD_FRAMEWORK_MAP: ReadonlyMap<string, string> = new Map([
  ['github.com/gin-gonic/gin',           'gin'],
  ['github.com/labstack/echo',           'echo'],
  ['github.com/go-chi/chi',              'chi'],
  ['github.com/gorilla/mux',             'gorilla/mux'],
  ['github.com/gofiber/fiber',           'fiber'],
  ['google.golang.org/grpc',             'grpc'],
  ['github.com/spf13/cobra',             'cobra'],
  ['github.com/urfave/cli',              'urfave/cli'],
  ['github.com/segmentio/kafka-go',      'kafka-go'],
  ['github.com/Shopify/sarama',          'sarama'],
  ['github.com/IBM/sarama',              'sarama'],
  ['github.com/nats-io/nats.go',         'nats'],
  ['github.com/robfig/cron',             'cron'],
]);

// Extended import-path prefix table for Layer 2 (catches frameworks not in go.mod directly)
const IMPORT_PATH_FRAMEWORK_MAP: ReadonlyMap<string, string> = new Map([
  ['github.com/beego/beego',                      'beego'],
  ['github.com/cloudwego/hertz',                  'hertz'],
  ['github.com/kataras/iris',                     'iris'],
  ['github.com/confluentinc/confluent-kafka-go',  'confluent-kafka'],
]);

export class FrameworkDetector {
  /**
   * Run all three detection layers and return the combined set of detected framework keys.
   * 'net/http' is always included unconditionally (standard library).
   */
  detect(moduleInfo: ModuleInfo | null | undefined, rawData: GoRawData): DetectedFrameworks {
    const found = new Set<string>();
    found.add('net/http'); // unconditional — standard library always available
    if (moduleInfo) this.detectFromGoMod(moduleInfo, found);
    this.detectFromImports(rawData, found);
    this.detectFromSignatures(rawData, found);
    return found;
  }

  /** Layer 1: scan go.mod require entries against the framework map */
  private detectFromGoMod(moduleInfo: ModuleInfo, found: Set<string>): void {
    for (const req of moduleInfo.requires) {
      for (const [prefix, key] of GO_MOD_FRAMEWORK_MAP) {
        if (req.path === prefix || req.path.startsWith(prefix + '/')) {
          found.add(key);
        }
      }
    }
  }

  /** Layer 2: scan GoRawData import paths — zero additional I/O */
  private detectFromImports(rawData: GoRawData, found: Set<string>): void {
    for (const pkg of rawData.packages) {
      for (const imp of pkg.imports) {
        // Also check GO_MOD_FRAMEWORK_MAP for import path prefixes
        for (const [prefix, key] of GO_MOD_FRAMEWORK_MAP) {
          if (imp.path === prefix || imp.path.startsWith(prefix + '/')) {
            found.add(key);
          }
        }
        // Extended table for frameworks with different go.mod vs import path
        for (const [prefix, key] of IMPORT_PATH_FRAMEWORK_MAP) {
          if (imp.path === prefix || imp.path.startsWith(prefix + '/')) {
            found.add(key);
          }
        }
      }
    }
  }

  /** Layer 3: signature-based fallback — framework-agnostic patterns */
  private detectFromSignatures(rawData: GoRawData, found: Set<string>): void {
    for (const pkg of rawData.packages) {
      // 3b: main() in package main — universal CLI anchor
      if (pkg.name === 'main') {
        found.add('main');
      }
      // 3a: ServeHTTP(http.ResponseWriter, *http.Request) — any http.Handler implementor
      for (const struct of pkg.structs || []) {
        for (const method of struct.methods || []) {
          if (this.isServeHTTP(method)) {
            found.add('serve-http');
          }
        }
      }
    }
  }

  private isServeHTTP(method: GoMethod): boolean {
    if (method.name !== 'ServeHTTP') return false;
    if (method.parameters.length !== 2) return false;
    const p0 = method.parameters[0].type;
    const p1 = method.parameters[1].type;
    return (p0 === 'http.ResponseWriter' || p0.endsWith('.ResponseWriter')) &&
           (p1 === '*http.Request' || p1.endsWith('.Request'));
  }
}
