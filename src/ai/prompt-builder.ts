/**
 * Prompt Builder for Claude API
 * Constructs prompts for PlantUML generation with few-shot examples
 */

import { ArchJSON } from '../types';

/**
 * PromptBuilder - builds effective prompts for PlantUML generation
 */
export class PromptBuilder {
  private systemPrompt = `You are a senior software architect and PlantUML expert.

Your responsibilities:
1. Generate clean, professional UML class diagrams
2. Follow PlantUML best practices
3. Use modern themes and styling
4. Ensure diagrams are readable and well-organized

Quality standards:
- Syntax must be 100% valid
- All entities from input must be included
- Relationships must be accurately represented
- Visibility modifiers must be shown
- Code should be well-formatted

Output format:
- Start with @startuml
- Include theme declaration
- Use packages for organization when appropriate
- End with @enduml
- No explanations, only code`;

  /**
   * Get the system prompt
   */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * Build a complete prompt for PlantUML class diagram generation
   */
  buildClassDiagramPrompt(archJson: ArchJSON): string {
    return `${this.systemPrompt}

${this.getFewShotExamples()}

Now generate a PlantUML class diagram for this architecture:

\`\`\`json
${JSON.stringify(archJson, null, 2)}
\`\`\`

${this.getOutputConstraints()}

Output ONLY the PlantUML code, no explanations.`;
  }

  /**
   * Get few-shot learning examples
   */
  private getFewShotExamples(): string {
    return `Here are examples of expected output:

Example 1: Simple class
Input:
\`\`\`json
{
  "entities": [
    {
      "name": "User",
      "type": "class",
      "members": [
        {
          "name": "id",
          "type": "property",
          "visibility": "private",
          "fieldType": "string"
        },
        {
          "name": "name",
          "type": "property",
          "visibility": "private",
          "fieldType": "string"
        },
        {
          "name": "getName",
          "type": "method",
          "visibility": "public",
          "returnType": "string"
        }
      ]
    }
  ],
  "relations": []
}
\`\`\`

Output:
\`\`\`plantuml
@startuml
!theme cerulean-outline

class User {
  -id: string
  -name: string
  +getName(): string
}

@enduml
\`\`\`

Example 2: Inheritance
Input:
\`\`\`json
{
  "entities": [
    {
      "name": "User",
      "type": "class",
      "members": [
        {
          "name": "email",
          "type": "property",
          "visibility": "protected",
          "fieldType": "string"
        }
      ]
    },
    {
      "name": "Admin",
      "type": "class",
      "members": [
        {
          "name": "role",
          "type": "property",
          "visibility": "private",
          "fieldType": "string"
        }
      ]
    }
  ],
  "relations": [
    {
      "type": "inheritance",
      "source": "Admin",
      "target": "User"
    }
  ]
}
\`\`\`

Output:
\`\`\`plantuml
@startuml
!theme cerulean-outline

class User {
  #email: string
}

class Admin {
  -role: string
}

Admin --|> User : extends

@enduml
\`\`\`

Example 3: Interface implementation
Input:
\`\`\`json
{
  "entities": [
    {
      "name": "IUserRepository",
      "type": "interface",
      "members": [
        {
          "name": "findById",
          "type": "method",
          "visibility": "public",
          "parameters": [{"name": "id", "type": "string"}],
          "returnType": "User"
        },
        {
          "name": "save",
          "type": "method",
          "visibility": "public",
          "parameters": [{"name": "user", "type": "User"}],
          "returnType": "void"
        }
      ]
    },
    {
      "name": "UserRepository",
      "type": "class",
      "members": [
        {
          "name": "db",
          "type": "property",
          "visibility": "private",
          "fieldType": "Database"
        },
        {
          "name": "findById",
          "type": "method",
          "visibility": "public",
          "parameters": [{"name": "id", "type": "string"}],
          "returnType": "User"
        },
        {
          "name": "save",
          "type": "method",
          "visibility": "public",
          "parameters": [{"name": "user", "type": "User"}],
          "returnType": "void"
        }
      ]
    }
  ],
  "relations": [
    {
      "type": "implementation",
      "source": "UserRepository",
      "target": "IUserRepository"
    }
  ]
}
\`\`\`

Output:
\`\`\`plantuml
@startuml
!theme cerulean-outline

interface IUserRepository {
  +findById(id: string): User
  +save(user: User): void
}

class UserRepository {
  -db: Database
  +findById(id: string): User
  +save(user: User): void
}

UserRepository ..|> IUserRepository : implements

@enduml
\`\`\`

Example 4: Composition and dependency
Input:
\`\`\`json
{
  "entities": [
    {
      "name": "Engine",
      "type": "class",
      "members": []
    },
    {
      "name": "Car",
      "type": "class",
      "members": [
        {
          "name": "engine",
          "type": "property",
          "visibility": "private",
          "fieldType": "Engine"
        }
      ]
    },
    {
      "name": "Driver",
      "type": "class",
      "members": [
        {
          "name": "drive",
          "type": "method",
          "visibility": "public",
          "parameters": [{"name": "car", "type": "Car"}],
          "returnType": "void"
        }
      ]
    }
  ],
  "relations": [
    {
      "type": "composition",
      "source": "Car",
      "target": "Engine"
    },
    {
      "type": "dependency",
      "source": "Driver",
      "target": "Car"
    }
  ]
}
\`\`\`

Output:
\`\`\`plantuml
@startuml
!theme cerulean-outline

class Engine

class Car {
  -engine: Engine
}

class Driver {
  +drive(car: Car): void
}

Car --* Engine : contains
Driver --> Car : uses

@enduml
\`\`\``;
  }

  /**
   * Get output constraints and requirements
   */
  private getOutputConstraints(): string {
    return `Requirements:
1. Syntax: Valid PlantUML (test with plantuml.com)
2. Structure: @startuml...@enduml
3. Theme: Use !theme cerulean-outline
4. ⭐ Layout: PREFER VERTICAL LAYOUT (top to bottom)
   - Add "top to bottom direction" after @startuml
   - Use skinparam ranksep 40 for better spacing
   - Vertical layout is preferred for layered architectures
5. Visibility:
   - + for public
   - - for private
   - # for protected
6. Types: Include parameter and return types
7. ⭐ Organization: MUST USE PACKAGES to group related entities
8. Relationships:
   - --|> for inheritance (extends)
   - ..|> for implementation (implements)
   - --* for composition (contains)
   - --o for aggregation (has)
   - --> for dependency (uses)
9. Formatting: Clean, readable, consistent indentation
10. Include ALL entities from the input JSON

⚠️ CRITICAL: Vertical Layout (Preferred)
- Use "top to bottom direction" for layered architectures
- Add "skinparam ranksep 40" to increase vertical spacing
- This works well for: AI → CLI → Parser → Types layers

Example of VERTICAL layout:
  @startuml
  !theme cerulean-outline
  top to bottom direction
  skinparam ranksep 40

  package "AI Layer" { ... }
  package "CLI Layer" { ... }
  package "Parser Layer" { ... }
  @enduml

When to use HORIZONTAL layout:
- Data flows clearly left-to-right
- Explicit upstream/downstream relationships
- Vertical layout would make diagram too tall

⚠️ CRITICAL: Modular Organization with Packages
- MUST group related entities into packages using "package Name { ... }"
- Group by functional layers (AI Layer, Parser Layer, CLI Layer, Types, etc.)
- Group by responsibility (Generator, Validator, Renderer, Parser, Config, etc.)
- Package names should clearly reflect the module's purpose
- Cross-package relationships should be clearly visible

Examples of GOOD modular organization:
  package "AI Layer" {
    class PlantUMLGenerator
    class PlantUMLValidator
    class PlantUMLRenderer
  }

  package "Parser Layer" {
    class TypeScriptParser
    class ClassExtractor
    class InterfaceExtractor
  }

  package "Types" {
    interface ArchJSON
    interface Entity
    interface Relation
  }

Examples of BAD organization (DO NOT DO THIS):
  @startuml
  ' ❌ All classes at top level, no packages
  class PlantUMLGenerator
  class PlantUMLValidator
  class TypeScriptParser
  class ClassExtractor
  @enduml

⚠️ CRITICAL: Relationship Reference Constraints
- ONLY reference entities that are DEFINED in the diagram
- NEVER reference external library types (Error, EventEmitter, Anthropic, Ora, etc.)
- NEVER reference generic type parameters (T, K, V, Map<K,V>, Promise<T>, etc.)
- NEVER reference built-in types (string, number, Date, etc.) in relationships

Examples of INVALID relationships (DO NOT DO THIS):
  ClaudeConnector *-- Anthropic              ❌ Anthropic is external
  ClaudeAPIError --|> Error                  ❌ Error is not defined
  ProgressReporter *-- Ora                   ❌ Ora is external package
  CacheManager ..> T : dependency            ❌ T is generic parameter

Examples of VALID relationships (DO THIS):
  ClaudeConnector *-- ClaudeConnectorConfig  ✅ Defined in diagram
  PlantUMLGenerator *-- ClaudeCodeWrapper    ✅ Defined in diagram
  TypeScriptParser *-- ClassExtractor        ✅ Defined in diagram

DO NOT:
- Add explanatory text
- Use invalid PlantUML syntax
- Omit entities from input
- Add entities not in input
- Leave entities unorganized (USE PACKAGES!)
- Use excessive layout controls (let PlantUML auto-layout work)`;
  }
}
