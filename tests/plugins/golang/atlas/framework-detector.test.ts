import { describe, it, expect } from 'vitest';
import { FrameworkDetector } from '@/plugins/golang/atlas/framework-detector.js';
import type { ModuleInfo } from '@/plugins/golang/atlas/go-mod-resolver.js';
import type { GoRawData, GoRawPackage } from '@/plugins/golang/types.js';

function makeModuleInfo(overrides?: Partial<ModuleInfo>): ModuleInfo {
  return {
    moduleName: 'github.com/example/app',
    moduleRoot: '/test',
    goModPath: '/test/go.mod',
    requires: [],
    ...overrides,
  };
}

function makeRawData(overrides?: Partial<GoRawData>): GoRawData {
  return {
    packages: [],
    moduleRoot: '/test',
    moduleName: 'github.com/example/app',
    ...overrides,
  };
}

function makePkg(overrides?: Partial<GoRawPackage>): GoRawPackage {
  return {
    id: 'pkg/api',
    name: 'api',
    fullName: 'pkg/api',
    dirPath: '/test/pkg/api',
    sourceFiles: ['api.go'],
    imports: [],
    structs: [],
    interfaces: [],
    functions: [],
    ...overrides,
  };
}

describe('FrameworkDetector', () => {
  const detector = new FrameworkDetector();

  describe('always includes net/http', () => {
    it('net/http is detected even with no requires and no imports', () => {
      const result = detector.detect(makeModuleInfo(), makeRawData());
      expect(result.has('net/http')).toBe(true);
    });
  });

  describe('Layer 1 — go.mod require scan', () => {
    it('detects gin from go.mod require', () => {
      const moduleInfo = makeModuleInfo({
        requires: [{ path: 'github.com/gin-gonic/gin', version: 'v1.9.1', indirect: false }],
      });
      const result = detector.detect(moduleInfo, makeRawData());
      expect(result.has('gin')).toBe(true);
    });

    it('detects grpc from go.mod require', () => {
      const moduleInfo = makeModuleInfo({
        requires: [{ path: 'google.golang.org/grpc', version: 'v1.60.0', indirect: false }],
      });
      const result = detector.detect(moduleInfo, makeRawData());
      expect(result.has('grpc')).toBe(true);
    });

    it('detects cobra from go.mod require', () => {
      const moduleInfo = makeModuleInfo({
        requires: [{ path: 'github.com/spf13/cobra', version: 'v1.8.0', indirect: false }],
      });
      const result = detector.detect(moduleInfo, makeRawData());
      expect(result.has('cobra')).toBe(true);
    });

    it('detects indirect dependencies too', () => {
      const moduleInfo = makeModuleInfo({
        requires: [{ path: 'github.com/gorilla/mux', version: 'v1.8.1', indirect: true }],
      });
      const result = detector.detect(moduleInfo, makeRawData());
      expect(result.has('gorilla/mux')).toBe(true);
    });

    it('detects sarama under IBM namespace', () => {
      const moduleInfo = makeModuleInfo({
        requires: [{ path: 'github.com/IBM/sarama', version: 'v1.42.0', indirect: false }],
      });
      const result = detector.detect(moduleInfo, makeRawData());
      expect(result.has('sarama')).toBe(true);
    });

    it('ignores unrecognised modules', () => {
      const moduleInfo = makeModuleInfo({
        requires: [{ path: 'github.com/some/unknown-lib', version: 'v1.0.0', indirect: false }],
      });
      const result = detector.detect(moduleInfo, makeRawData());
      // Only net/http should be present
      expect(result.size).toBe(1);
      expect(result.has('net/http')).toBe(true);
    });

    it('detects multiple frameworks from go.mod', () => {
      const moduleInfo = makeModuleInfo({
        requires: [
          { path: 'github.com/gin-gonic/gin', version: 'v1.9.1', indirect: false },
          { path: 'google.golang.org/grpc', version: 'v1.60.0', indirect: false },
          { path: 'github.com/spf13/cobra', version: 'v1.8.0', indirect: false },
        ],
      });
      const result = detector.detect(moduleInfo, makeRawData());
      expect(result.has('gin')).toBe(true);
      expect(result.has('grpc')).toBe(true);
      expect(result.has('cobra')).toBe(true);
    });
  });

  describe('Layer 2 — GoRawData import scan', () => {
    it('detects beego from import path', () => {
      const rawData = makeRawData({
        packages: [
          makePkg({
            imports: [
              { path: 'github.com/beego/beego/v2/server/web', location: { file: 'app.go', startLine: 1, endLine: 1 } },
            ],
          }),
        ],
      });
      const result = detector.detect(makeModuleInfo(), rawData);
      expect(result.has('beego')).toBe(true);
    });

    it('detects hertz from import path', () => {
      const rawData = makeRawData({
        packages: [
          makePkg({
            imports: [
              { path: 'github.com/cloudwego/hertz/pkg/app', location: { file: 'app.go', startLine: 1, endLine: 1 } },
            ],
          }),
        ],
      });
      const result = detector.detect(makeModuleInfo(), rawData);
      expect(result.has('hertz')).toBe(true);
    });

    it('detects gin from import path even without go.mod entry', () => {
      const rawData = makeRawData({
        packages: [
          makePkg({
            imports: [
              { path: 'github.com/gin-gonic/gin', location: { file: 'router.go', startLine: 1, endLine: 1 } },
            ],
          }),
        ],
      });
      const result = detector.detect(makeModuleInfo(), rawData);
      expect(result.has('gin')).toBe(true);
    });
  });

  describe('Layer 3 — signature-based fallback', () => {
    it('detects main from package named main', () => {
      const rawData = makeRawData({
        packages: [
          makePkg({ name: 'main', fullName: 'cmd/server' }),
        ],
      });
      const result = detector.detect(makeModuleInfo(), rawData);
      expect(result.has('main')).toBe(true);
    });

    it('does not add main for non-main packages', () => {
      const rawData = makeRawData({
        packages: [
          makePkg({ name: 'api', fullName: 'pkg/api' }),
        ],
      });
      const result = detector.detect(makeModuleInfo(), rawData);
      expect(result.has('main')).toBe(false);
    });

    it('detects serve-http from ServeHTTP method with correct signature', () => {
      const rawData = makeRawData({
        packages: [
          makePkg({
            structs: [
              {
                name: 'MyHandler',
                packageName: 'api',
                exported: true,
                fields: [],
                embeddedTypes: [],
                methods: [
                  {
                    name: 'ServeHTTP',
                    packageName: 'api',
                    receiverType: 'MyHandler',
                    parameters: [
                      { name: 'w', type: 'http.ResponseWriter', exported: false, location: { file: 'handler.go', startLine: 10, endLine: 10 } },
                      { name: 'r', type: '*http.Request', exported: false, location: { file: 'handler.go', startLine: 10, endLine: 10 } },
                    ],
                    returnTypes: [],
                    exported: true,
                    location: { file: 'handler.go', startLine: 10, endLine: 15 },
                  },
                ],
                location: { file: 'handler.go', startLine: 5, endLine: 20 },
              },
            ],
          }),
        ],
      });
      const result = detector.detect(makeModuleInfo(), rawData);
      expect(result.has('serve-http')).toBe(true);
    });

    it('does not detect serve-http for ServeHTTP with wrong parameter count', () => {
      const rawData = makeRawData({
        packages: [
          makePkg({
            structs: [
              {
                name: 'MyHandler',
                packageName: 'api',
                exported: true,
                fields: [],
                embeddedTypes: [],
                methods: [
                  {
                    name: 'ServeHTTP',
                    packageName: 'api',
                    receiverType: 'MyHandler',
                    parameters: [
                      { name: 'w', type: 'http.ResponseWriter', exported: false, location: { file: 'handler.go', startLine: 10, endLine: 10 } },
                    ],
                    returnTypes: [],
                    exported: true,
                    location: { file: 'handler.go', startLine: 10, endLine: 15 },
                  },
                ],
                location: { file: 'handler.go', startLine: 5, endLine: 20 },
              },
            ],
          }),
        ],
      });
      const result = detector.detect(makeModuleInfo(), rawData);
      expect(result.has('serve-http')).toBe(false);
    });

    it('does not detect serve-http for wrong method name', () => {
      const rawData = makeRawData({
        packages: [
          makePkg({
            structs: [
              {
                name: 'MyHandler',
                packageName: 'api',
                exported: true,
                fields: [],
                embeddedTypes: [],
                methods: [
                  {
                    name: 'HandleHTTP',
                    packageName: 'api',
                    receiverType: 'MyHandler',
                    parameters: [
                      { name: 'w', type: 'http.ResponseWriter', exported: false, location: { file: 'handler.go', startLine: 10, endLine: 10 } },
                      { name: 'r', type: '*http.Request', exported: false, location: { file: 'handler.go', startLine: 10, endLine: 10 } },
                    ],
                    returnTypes: [],
                    exported: true,
                    location: { file: 'handler.go', startLine: 10, endLine: 15 },
                  },
                ],
                location: { file: 'handler.go', startLine: 5, endLine: 20 },
              },
            ],
          }),
        ],
      });
      const result = detector.detect(makeModuleInfo(), rawData);
      expect(result.has('serve-http')).toBe(false);
    });
  });

  describe('combined detection', () => {
    it('combines all layers correctly', () => {
      const moduleInfo = makeModuleInfo({
        requires: [{ path: 'github.com/gin-gonic/gin', version: 'v1.9.1', indirect: false }],
      });
      const rawData = makeRawData({
        packages: [
          makePkg({
            name: 'main',
            fullName: 'cmd/server',
            imports: [
              { path: 'github.com/cloudwego/hertz/pkg/app', location: { file: 'main.go', startLine: 1, endLine: 1 } },
            ],
          }),
        ],
      });
      const result = detector.detect(moduleInfo, rawData);
      expect(result.has('net/http')).toBe(true);
      expect(result.has('gin')).toBe(true);
      expect(result.has('hertz')).toBe(true);
      expect(result.has('main')).toBe(true);
    });
  });
});
