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
4. Visibility:
   - + for public
   - - for private
   - # for protected
5. Types: Include parameter and return types
6. Organization: Group related classes with packages when appropriate
7. Relationships:
   - --|> for inheritance (extends)
   - ..|> for implementation (implements)
   - --* for composition (contains)
   - --o for aggregation (has)
   - --> for dependency (uses)
8. Formatting: Clean, readable, consistent indentation
9. Include ALL entities from the input JSON
10. Use appropriate relationship arrows with labels

DO NOT:
- Add explanatory text
- Use invalid PlantUML syntax
- Omit entities from input
- Add entities not in input`;
  }
}
