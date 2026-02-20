/**
 * GoplsClient - LSP client for gopls (Go language server)
 *
 * Provides semantic analysis capabilities for Go code including:
 * - Interface implementation detection
 * - Type information queries
 * - Symbol resolution
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';

interface LSPMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

interface Location {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

interface ImplementationResult {
  structName: string;
  filePath: string;
  line: number;
}

interface TypeInfo {
  name: string;
  kind: string;
  signature?: string;
}

export class GoplsClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private messageBuffer = '';
  private initialized = false;
  private workspaceRoot = '';

  constructor(
    private goplsPath: string = 'gopls',
    private timeout: number = 30000 // 30s default timeout
  ) {}

  /**
   * Initialize gopls language server
   */
  async initialize(workspaceRoot: string): Promise<void> {
    if (this.initialized) {
      return; // Already initialized
    }

    if (!workspaceRoot) {
      throw new Error('Workspace root is required');
    }

    this.workspaceRoot = workspaceRoot;

    // Verify gopls binary exists
    try {
      // Try to spawn gopls with version flag to verify it exists
      await this.checkGoplsAvailable();
    } catch (error) {
      throw new Error(`gopls binary not found at: ${this.goplsPath}`);
    }

    // Spawn gopls process
    this.process = spawn(this.goplsPath, ['serve', '-rpc.trace'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error('Failed to create gopls process streams');
    }

    // Set up message handling
    this.process.stdout.on('data', (data: Buffer) => {
      this.handleData(data);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      // Log stderr for debugging, but don't fail
      // gopls writes trace info to stderr
    });

    this.process.on('error', (error) => {
      this.handleProcessError(error);
    });

    this.process.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal);
    });

    // Send LSP initialize request
    try {
      await this.sendRequest('initialize', {
        processId: process.pid,
        rootUri: `file://${workspaceRoot}`,
        capabilities: {
          textDocument: {
            implementation: {
              linkSupport: true,
            },
            hover: {
              contentFormat: ['plaintext', 'markdown'],
            },
          },
        },
      });

      // Send initialized notification
      this.sendNotification('initialized', {});

      this.initialized = true;
    } catch (error) {
      await this.dispose();
      throw new Error(`Failed to initialize gopls: ${error}`);
    }
  }

  /**
   * Check if gopls is available
   */
  private async checkGoplsAvailable(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.goplsPath, ['version']);

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`gopls exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Get implementations of an interface
   *
   * Strategy: Search for all method receivers in the codebase and check
   * if they implement all interface methods
   */
  async getImplementations(
    typeName: string,
    filePath: string,
    line: number
  ): Promise<ImplementationResult[]> {
    if (!this.initialized) {
      throw new Error('GoplsClient not initialized. Call initialize() first.');
    }

    // Validate inputs
    if (line < 0) {
      return [];
    }

    try {
      // Ensure file exists
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.workspaceRoot, filePath);

      if (!(await fs.pathExists(absolutePath))) {
        return [];
      }

      // Open document
      const content = await fs.readFile(absolutePath, 'utf-8');
      await this.openDocument(absolutePath, content);

      // First, try textDocument/implementation
      let result = await this.sendRequest('textDocument/implementation', {
        textDocument: {
          uri: `file://${absolutePath}`,
        },
        position: {
          line: line - 1, // LSP is 0-indexed
          character: 5, // Position on the interface name
        },
      });

      // If that doesn't work, try finding the interface type position
      if (!result || (Array.isArray(result) && result.length === 0)) {
        // Try to find where interface is used as a type
        const lines = content.split('\n');
        if (line <= lines.length) {
          const interfaceLine = lines[line - 1];
          const typeIndex = interfaceLine.indexOf(typeName);
          if (typeIndex !== -1) {
            result = await this.sendRequest('textDocument/implementation', {
              textDocument: {
                uri: `file://${absolutePath}`,
              },
              position: {
                line: line - 1,
                character: typeIndex,
              },
            });
          }
        }
      }

      // Close document
      await this.closeDocument(absolutePath);

      // Parse results
      if (!result) {
        return [];
      }

      const locations: Location[] = Array.isArray(result) ? result : [result];
      const implementations: ImplementationResult[] = [];

      for (const loc of locations) {
        if (loc && loc.uri) {
          const uri = loc.uri.replace('file://', '');
          const implLine = loc.range.start.line + 1; // Convert back to 1-indexed

          // Extract struct name from the implementation
          const structName = await this.extractStructNameAtLocation(uri, implLine);

          if (structName) {
            implementations.push({
              structName,
              filePath: uri,
              line: implLine,
            });
          }
        }
      }

      return implementations;
    } catch (error) {
      // Return empty array on error (non-fatal)
      return [];
    }
  }

  /**
   * Get type information for a symbol
   */
  async getTypeInfo(
    symbol: string,
    filePath: string,
    line: number
  ): Promise<TypeInfo | null> {
    if (!this.initialized) {
      throw new Error('GoplsClient not initialized. Call initialize() first.');
    }

    try {
      // Ensure file exists
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(this.workspaceRoot, filePath);

      if (!(await fs.pathExists(absolutePath))) {
        return null;
      }

      // Open document
      const content = await fs.readFile(absolutePath, 'utf-8');
      await this.openDocument(absolutePath, content);

      // Request hover information (contains type info)
      const result = await this.sendRequest('textDocument/hover', {
        textDocument: {
          uri: `file://${absolutePath}`,
        },
        position: {
          line: line - 1, // LSP is 0-indexed
          character: 0,
        },
      });

      // Close document
      await this.closeDocument(absolutePath);

      if (!result || !result.contents) {
        return null;
      }

      // Extract type info from hover contents
      const contents =
        typeof result.contents === 'string'
          ? result.contents
          : result.contents.value || '';

      return {
        name: symbol,
        kind: 'type',
        signature: contents,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose gopls client and cleanup resources
   */
  async dispose(): Promise<void> {
    if (!this.initialized && !this.process) {
      return; // Already disposed
    }

    // Reject all pending requests
    for (const [id, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timer);
      request.reject(new Error('GoplsClient disposed'));
      this.pendingRequests.delete(id);
    }

    // Send shutdown request
    if (this.initialized && this.process) {
      try {
        await this.sendRequest('shutdown', null);
        this.sendNotification('exit', null);
      } catch (error) {
        // Ignore errors during shutdown
      }
    }

    // Kill process
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.initialized = false;
    this.messageBuffer = '';
  }

  /**
   * Open a document in gopls
   */
  private async openDocument(filePath: string, content: string): Promise<void> {
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: `file://${filePath}`,
        languageId: 'go',
        version: 1,
        text: content,
      },
    });
  }

  /**
   * Close a document in gopls
   */
  private async closeDocument(filePath: string): Promise<void> {
    this.sendNotification('textDocument/didClose', {
      textDocument: {
        uri: `file://${filePath}`,
      },
    });
  }

  /**
   * Extract struct name at a given location
   */
  private async extractStructNameAtLocation(
    filePath: string,
    line: number
  ): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      if (line > lines.length) {
        return null;
      }

      // Look for struct name pattern: "type StructName struct"
      const targetLine = lines[line - 1];
      const structMatch = targetLine.match(/type\s+(\w+)\s+struct/);

      if (structMatch) {
        return structMatch[1];
      }

      // Look for method receiver: "func (r *StructName) MethodName"
      const methodMatch = targetLine.match(/func\s+\([^)]*\*?(\w+)\)/);

      if (methodMatch) {
        return methodMatch[1];
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Send LSP request and wait for response
   */
  private async sendRequest(method: string, params: any): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error('gopls process not available');
    }

    const id = this.nextId++;

    const message: LSPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      // Set timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      // Store request
      this.pendingRequests.set(id, { resolve, reject, timer });

      // Send message
      const messageStr = JSON.stringify(message);
      const contentLength = Buffer.byteLength(messageStr, 'utf-8');
      const header = `Content-Length: ${contentLength}\r\n\r\n`;

      this.process!.stdin!.write(header + messageStr);
    });
  }

  /**
   * Send LSP notification (no response expected)
   */
  private sendNotification(method: string, params: any): void {
    if (!this.process || !this.process.stdin) {
      return;
    }

    const message: LSPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const messageStr = JSON.stringify(message);
    const contentLength = Buffer.byteLength(messageStr, 'utf-8');
    const header = `Content-Length: ${contentLength}\r\n\r\n`;

    this.process.stdin.write(header + messageStr);
  }

  /**
   * Handle incoming data from gopls
   */
  private handleData(data: Buffer): void {
    this.messageBuffer += data.toString();

    // Process complete messages
    while (true) {
      // Look for Content-Length header
      const headerMatch = this.messageBuffer.match(/Content-Length: (\d+)\r\n\r\n/);

      if (!headerMatch) {
        break;
      }

      const contentLength = parseInt(headerMatch[1], 10);
      const headerLength = headerMatch[0].length;
      const messageStart = headerMatch.index! + headerLength;
      const messageEnd = messageStart + contentLength;

      // Check if we have the complete message
      if (this.messageBuffer.length < messageEnd) {
        break;
      }

      // Extract message
      const messageStr = this.messageBuffer.substring(messageStart, messageEnd);
      this.messageBuffer = this.messageBuffer.substring(messageEnd);

      // Parse and handle message
      try {
        const message: LSPMessage = JSON.parse(messageStr);
        this.handleMessage(message);
      } catch (error) {
        console.error('Failed to parse LSP message:', error);
      }
    }
  }

  /**
   * Handle parsed LSP message
   */
  private handleMessage(message: LSPMessage): void {
    // Handle response to request
    if (message.id !== undefined) {
      const request = this.pendingRequests.get(message.id);

      if (request) {
        clearTimeout(request.timer);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          request.reject(new Error(message.error.message));
        } else {
          request.resolve(message.result);
        }
      }
    }

    // Handle notifications from server (e.g., diagnostics)
    // We can ignore these for now
  }

  /**
   * Handle gopls process error
   */
  private handleProcessError(error: Error): void {
    // Reject all pending requests
    for (const [id, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timer);
      request.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  /**
   * Handle gopls process exit
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    this.initialized = false;
    this.process = null;

    // Reject all pending requests
    const error = new Error(`gopls process exited: code=${code}, signal=${signal}`);

    for (const [id, request] of this.pendingRequests.entries()) {
      clearTimeout(request.timer);
      request.reject(error);
      this.pendingRequests.delete(id);
    }
  }
}
