/**
 * Tests for GoPlugin - orphaned method re-attachment during package merge
 *
 * When Go files in the same package define methods on structs declared in other
 * files, tree-sitter-bridge stores these as `orphanedMethods` on the per-file
 * GoRawPackage. During the merge pass in parseToRawData, those orphaned methods
 * must be re-attached to their owning struct.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoPlugin } from '../../../src/plugins/golang/index.js';
import type { GoRawPackage } from '../../../src/plugins/golang/types.js';

// Mock glob at the module level so ESM non-configurable exports are handled
vi.mock('glob', () => ({
  glob: vi.fn(),
}));

// Mock fs-extra so no real filesystem access occurs
vi.mock('fs-extra', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue('// dummy go code'),
    existsSync: vi.fn().mockReturnValue(false),
    statSync: vi.fn(),
  },
}));

// Workspace root used in all tests
const WS = '/fake/root';

describe('GoPlugin - orphaned method re-attachment', () => {
  let plugin: GoPlugin;

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin = new GoPlugin();
    await plugin.initialize({ workspaceRoot: WS });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-attaches orphaned methods to their struct after merging package files', async () => {
    // Files sit UNDER the workspace root so path.relative produces 'pkg/hub'
    const serverFile = `${WS}/pkg/hub/server.go`;
    const handlerFile = `${WS}/pkg/hub/handlers_health.go`;

    const { glob } = await import('glob');
    vi.mocked(glob).mockResolvedValue([serverFile, handlerFile] as any);

    const bridge = (plugin as any).treeSitter;
    vi.spyOn(bridge, 'parseCode').mockImplementation(
      (_code: string, filePath: string): GoRawPackage => {
        if (filePath === serverFile) {
          // File 1: defines the struct, no methods
          return {
            name: 'hub',
            fullName: '',
            id: '',
            dirPath: '',
            sourceFiles: [serverFile],
            imports: [],
            structs: [
              {
                name: 'Server',
                packageName: 'hub',
                exported: true,
                fields: [],
                methods: [],
                embeddedTypes: [],
                location: { file: serverFile, startLine: 1, endLine: 10 },
              },
            ],
            interfaces: [],
            functions: [],
          };
        } else {
          // File 2: defines a method on Server (receiver struct is in another file)
          return {
            name: 'hub',
            fullName: '',
            id: '',
            dirPath: '',
            sourceFiles: [handlerFile],
            imports: [],
            structs: [],
            interfaces: [],
            functions: [],
            orphanedMethods: [
              {
                name: 'handleHealth',
                receiverType: 'Server',
                parameters: [],
                returnTypes: [],
                exported: false,
                body: {
                  calls: [
                    {
                      functionName: 'Respond',
                      packageName: 'util',
                      args: [],
                      location: { file: handlerFile, startLine: 5, endLine: 5 },
                    },
                  ],
                  goSpawns: [],
                  channelOps: [],
                },
                location: { file: handlerFile, startLine: 3, endLine: 8 },
              },
            ],
          };
        }
      }
    );

    const result = await plugin.parseToRawData(WS, {
      workspaceRoot: WS,
      extractBodies: true,
      selectiveExtraction: true,
    });

    // parseToRawData sets fullName = path.relative(WS, dirname(file)) = 'pkg/hub'
    const hubPkg = result.packages.find((p) => p.fullName === 'pkg/hub');
    expect(hubPkg).toBeDefined();

    const server = hubPkg!.structs.find((s) => s.name === 'Server');
    expect(server).toBeDefined();

    // The orphaned method must be re-attached to Server
    expect(server!.methods).toHaveLength(1);
    expect(server!.methods[0].name).toBe('handleHealth');
    expect(server!.methods[0].body).toBeDefined();
    expect(server!.methods[0].receiverType).toBe('Server');

    // orphanedMethods should be cleared after re-attachment
    expect(hubPkg!.orphanedMethods).toHaveLength(0);
  });

  it('leaves orphaned methods cleared when receiver struct does not exist in the package', async () => {
    const handlerFile = `${WS}/pkg/api/handlers.go`;

    const { glob } = await import('glob');
    vi.mocked(glob).mockResolvedValue([handlerFile] as any);

    const bridge = (plugin as any).treeSitter;
    vi.spyOn(bridge, 'parseCode').mockReturnValue({
      name: 'api',
      fullName: '',
      id: '',
      dirPath: '',
      sourceFiles: [handlerFile],
      imports: [],
      structs: [],
      interfaces: [],
      functions: [],
      orphanedMethods: [
        {
          name: 'doSomething',
          receiverType: 'NonExistentStruct',
          parameters: [],
          returnTypes: [],
          exported: false,
          location: { file: handlerFile, startLine: 1, endLine: 5 },
        },
      ],
    } as GoRawPackage);

    const result = await plugin.parseToRawData(WS, {
      workspaceRoot: WS,
      extractBodies: false,
    });

    const apiPkg = result.packages.find((p) => p.fullName === 'pkg/api');
    expect(apiPkg).toBeDefined();
    // No structs to attach to - method is silently dropped (struct doesn't exist)
    expect(apiPkg!.structs).toHaveLength(0);
    // orphanedMethods list is cleared after re-attachment pass
    expect(apiPkg!.orphanedMethods).toHaveLength(0);
  });

  it('accumulates orphaned methods from multiple files before re-attaching', async () => {
    const typesFile = `${WS}/pkg/service/types.go`;
    const userFile = `${WS}/pkg/service/user_handlers.go`;
    const authFile = `${WS}/pkg/service/auth_handlers.go`;

    const { glob } = await import('glob');
    vi.mocked(glob).mockResolvedValue([typesFile, userFile, authFile] as any);

    const bridge = (plugin as any).treeSitter;
    vi.spyOn(bridge, 'parseCode').mockImplementation(
      (_code: string, filePath: string): GoRawPackage => {
        if (filePath === typesFile) {
          // Defines two structs with no methods
          return {
            name: 'service',
            fullName: '',
            id: '',
            dirPath: '',
            sourceFiles: [typesFile],
            imports: [],
            structs: [
              {
                name: 'UserService',
                packageName: 'service',
                exported: true,
                fields: [],
                methods: [],
                embeddedTypes: [],
                location: { file: typesFile, startLine: 1, endLine: 5 },
              },
              {
                name: 'AuthService',
                packageName: 'service',
                exported: true,
                fields: [],
                methods: [],
                embeddedTypes: [],
                location: { file: typesFile, startLine: 7, endLine: 11 },
              },
            ],
            interfaces: [],
            functions: [],
          };
        } else if (filePath === userFile) {
          return {
            name: 'service',
            fullName: '',
            id: '',
            dirPath: '',
            sourceFiles: [userFile],
            imports: [],
            structs: [],
            interfaces: [],
            functions: [],
            orphanedMethods: [
              {
                name: 'GetUser',
                receiverType: 'UserService',
                parameters: [],
                returnTypes: [],
                exported: true,
                location: { file: userFile, startLine: 1, endLine: 5 },
              },
            ],
          };
        } else {
          // auth_handlers.go
          return {
            name: 'service',
            fullName: '',
            id: '',
            dirPath: '',
            sourceFiles: [authFile],
            imports: [],
            structs: [],
            interfaces: [],
            functions: [],
            orphanedMethods: [
              {
                name: 'Login',
                receiverType: 'AuthService',
                parameters: [],
                returnTypes: [],
                exported: true,
                location: { file: authFile, startLine: 1, endLine: 5 },
              },
            ],
          };
        }
      }
    );

    const result = await plugin.parseToRawData(WS, {
      workspaceRoot: WS,
      extractBodies: false,
    });

    const svcPkg = result.packages.find((p) => p.fullName === 'pkg/service');
    expect(svcPkg).toBeDefined();

    const userSvc = svcPkg!.structs.find((s) => s.name === 'UserService');
    expect(userSvc).toBeDefined();
    expect(userSvc!.methods).toHaveLength(1);
    expect(userSvc!.methods[0].name).toBe('GetUser');

    const authSvc = svcPkg!.structs.find((s) => s.name === 'AuthService');
    expect(authSvc).toBeDefined();
    expect(authSvc!.methods).toHaveLength(1);
    expect(authSvc!.methods[0].name).toBe('Login');

    expect(svcPkg!.orphanedMethods).toHaveLength(0);
  });
});
