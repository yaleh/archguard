import { InterfaceMatcher } from './interface-matcher.js';
import { GoplsClient } from './gopls-client.js';
import type { GoRawStruct, GoRawInterface, InferredImplementation } from './types.js';

type StructWithPackage = GoRawStruct & { packageName: string };
type InterfaceWithPackage = GoRawInterface & { packageName: string };

export class GoplsInterfaceResolver {
  private goplsClient: GoplsClient | null = null;
  private matcher: InterfaceMatcher;

  constructor() {
    this.matcher = new InterfaceMatcher();
  }

  async initialize(workspaceRoot: string): Promise<void> {
    try {
      this.goplsClient = new GoplsClient();
    } catch {
      this.goplsClient = null;
      console.warn('gopls not available, using fallback interface matcher');
      return;
    }

    if (this.goplsClient && !this.goplsClient.isInitialized()) {
      try {
        await this.goplsClient.initialize(workspaceRoot);
      } catch (error) {
        console.warn('Failed to initialize gopls, using fallback:', error);
        this.goplsClient = null;
      }
    }
  }

  async resolve(
    structs: StructWithPackage[],
    interfaces: InterfaceWithPackage[]
  ): Promise<InferredImplementation[]> {
    return this.matcher.matchWithGopls(structs, interfaces, this.goplsClient);
  }

  resolveSync(
    structs: StructWithPackage[],
    interfaces: InterfaceWithPackage[]
  ): InferredImplementation[] {
    return this.matcher.matchImplicitImplementations(structs, interfaces);
  }

  isGoplsAvailable(): boolean {
    return this.goplsClient !== null;
  }

  async dispose(): Promise<void> {
    if (this.goplsClient) {
      try {
        await this.goplsClient.dispose();
      } catch (error) {
        console.warn('Error disposing gopls client:', error);
      }
      this.goplsClient = null;
    }
  }
}
