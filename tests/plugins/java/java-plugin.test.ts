import { describe, it, expect, beforeEach } from 'vitest';
import { JavaPlugin } from '@/plugins/java/index.js';
import path from 'path';

describe('JavaPlugin', () => {
  let plugin: JavaPlugin;

  beforeEach(async () => {
    plugin = new JavaPlugin();
    await plugin.initialize({ workspaceRoot: process.cwd() });
  });

  describe('Metadata', () => {
    it('should have correct plugin metadata', () => {
      expect(plugin.metadata.name).toBe('java');
      expect(plugin.metadata.displayName).toBe('Java');
      expect(plugin.metadata.fileExtensions).toContain('.java');
      expect(plugin.metadata.capabilities.singleFileParsing).toBe(true);
      expect(plugin.metadata.capabilities.incrementalParsing).toBe(true);
      expect(plugin.metadata.capabilities.dependencyExtraction).toBe(true);
    });
  });

  describe('canHandle', () => {
    it('should handle .java files', () => {
      expect(plugin.canHandle('User.java')).toBe(true);
      expect(plugin.canHandle('/path/to/User.java')).toBe(true);
    });

    it('should not handle non-Java files', () => {
      expect(plugin.canHandle('User.ts')).toBe(false);
      expect(plugin.canHandle('User.go')).toBe(false);
    });

    it('should handle directories with pom.xml', () => {
      const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');
      expect(plugin.canHandle(fixturesPath)).toBe(true);
    });
  });

  describe('parseCode', () => {
    it('should parse a simple Java class', () => {
      const code = `
package com.example;

public class User {
  private String name;

  public String getName() {
    return name;
  }
}
      `;

      const result = plugin.parseCode(code, 'User.java');

      expect(result.version).toBe('1.0');
      expect(result.language).toBe('java');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('User');
      expect(result.entities[0].type).toBe('class');
    });

    it('should parse Java interface', () => {
      const code = `
package com.example;

public interface Service {
  void start();
  void stop();
}
      `;

      const result = plugin.parseCode(code, 'Service.java');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Service');
      expect(result.entities[0].type).toBe('interface');
    });

    it('should parse Java enum', () => {
      const code = `
package com.example;

public enum Status {
  ACTIVE,
  INACTIVE
}
      `;

      const result = plugin.parseCode(code, 'Status.java');

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].name).toBe('Status');
      expect(result.entities[0].type).toBe('enum');
    });

    it('should detect inheritance relationships', () => {
      const code = `
package com.example;

public class AdminUser extends User implements Service {
}
      `;

      const result = plugin.parseCode(code, 'AdminUser.java');

      expect(result.relations.length).toBeGreaterThan(0);
      const inheritanceRel = result.relations.find((r) => r.type === 'inheritance');
      expect(inheritanceRel).toBeDefined();

      const implRel = result.relations.find((r) => r.type === 'implementation');
      expect(implRel).toBeDefined();
    });
  });

  describe('parseFiles', () => {
    it('should parse multiple Java files', async () => {
      const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');
      const files = [
        path.join(fixturesPath, 'simple-class.java'),
        path.join(fixturesPath, 'interface.java'),
      ];

      const result = await plugin.parseFiles(files);

      expect(result.entities.length).toBeGreaterThanOrEqual(2);
      expect(result.sourceFiles).toEqual(files);
    });
  });

  describe('parseProject', () => {
    it('should parse a Java project directory', async () => {
      const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');

      const result = await plugin.parseProject(fixturesPath, {
        workspaceRoot: fixturesPath,
        excludePatterns: [],
      });

      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.language).toBe('java');
      expect(result.version).toBe('1.0');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid Java code gracefully', () => {
      const code = `
package com.example;

public class Invalid {
  // incomplete
      `;

      expect(() => {
        plugin.parseCode(code, 'Invalid.java');
      }).not.toThrow();
    });

    it('should handle empty code', () => {
      const result = plugin.parseCode('', 'Empty.java');

      expect(result.entities).toHaveLength(0);
      expect(result.relations).toHaveLength(0);
    });
  });

  describe('Dependency Extraction', () => {
    it('should extract dependencies from Maven project', async () => {
      const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'java');

      if (plugin.dependencyExtractor) {
        const dependencies = await plugin.dependencyExtractor.extractDependencies(fixturesPath);
        expect(dependencies.length).toBeGreaterThan(0);
      }
    });
  });

  describe('isTestFile', () => {
    it('has testStructureExtraction capability', () => {
      expect(plugin.metadata.capabilities.testStructureExtraction).toBe(true);
    });

    it('recognizes files in /test/ directory', () => {
      expect(plugin.isTestFile!('/project/src/test/java/com/example/FooTest.java')).toBe(true);
      expect(plugin.isTestFile!('/project/src/tests/java/com/example/Foo.java')).toBe(true);
    });

    it('recognizes Test-prefixed filenames', () => {
      expect(plugin.isTestFile!('/project/src/main/TestParser.java')).toBe(true);
      expect(plugin.isTestFile!('/project/src/TestModels.java')).toBe(true);
    });

    it('recognizes *Test.java, *Tests.java, *TestCase.java', () => {
      expect(plugin.isTestFile!('/project/FooTest.java')).toBe(true);
      expect(plugin.isTestFile!('/project/OpenAIServiceTests.java')).toBe(true);
      expect(plugin.isTestFile!('/project/FooTestCase.java')).toBe(true);
    });

    it('recognizes JMH benchmark files (*Bench.java, *Benchmark.java)', () => {
      expect(plugin.isTestFile!('/project/VectorPerfBench.java')).toBe(true);
      expect(plugin.isTestFile!('/project/TensorBenchmark.java')).toBe(true);
    });

    it('rejects non-Java and non-test files', () => {
      expect(plugin.isTestFile!('/project/src/main/Foo.java')).toBe(false);
      expect(plugin.isTestFile!('/project/src/MyService.java')).toBe(false);
      expect(plugin.isTestFile!('/project/test/foo.ts')).toBe(false);
    });
  });

  describe('extractTestStructure', () => {
    it('detects JUnit 4 framework', () => {
      const code = `
import org.junit.Test;
import org.junit.Assert;
public class FooTest {
  @Test
  public void testSomething() {
    Assert.assertEquals(1, 1);
  }
}`;
      const result = plugin.extractTestStructure!('/project/FooTest.java', code);
      expect(result).not.toBeNull();
      expect(result!.frameworks).toContain('junit4');
      expect(result!.frameworks).not.toContain('junit5');
    });

    it('detects JUnit 5 framework', () => {
      const code = `
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assertions;
public class ChatApiTest {
  @Test
  public void testChatCompletion() {
    Assertions.assertEquals(200, response.getStatus());
  }
}`;
      const result = plugin.extractTestStructure!('/project/ChatApiTest.java', code);
      expect(result).not.toBeNull();
      expect(result!.frameworks).toContain('junit5');
      expect(result!.frameworks).not.toContain('junit4');
    });

    it('detects JMH benchmark framework', () => {
      const code = `
import org.openjdk.jmh.annotations.*;
import org.openjdk.jmh.infra.Blackhole;
public class VectorPerfBench {
  @Benchmark
  public void benchDotProduct(Blackhole bh) {
    bh.consume(ops.dotProduct(a, b, 0, 0, SIZE));
  }
}`;
      const result = plugin.extractTestStructure!('/project/VectorPerfBench.java', code);
      expect(result).not.toBeNull();
      expect(result!.frameworks).toContain('jmh');
      expect(result!.testTypeHint).toBe('performance');
    });

    it('extracts @Test-annotated methods as test cases', () => {
      const code = `
import org.junit.Test;
public class TestParser {
  @Test
  public void testReadSafetensor() {
    Assert.assertEquals(16, data.length);
  }
  @Test
  public void testSlicing() {
    Assert.assertEquals(2, t.dims());
  }
}`;
      const result = plugin.extractTestStructure!('/project/TestParser.java', code);
      expect(result).not.toBeNull();
      expect(result!.testCases).toHaveLength(2);
      expect(result!.testCases.map((tc) => tc.name)).toContain('testReadSafetensor');
      expect(result!.testCases.map((tc) => tc.name)).toContain('testSlicing');
    });

    it('counts assertions correctly', () => {
      const code = `
import org.junit.Test;
import org.junit.Assert;
public class TestParser {
  @Test
  public void testSomething() {
    Assert.assertEquals(16, data.length);
    Assert.assertTrue(result > 0);
    Assert.assertNotNull(obj);
  }
}`;
      const result = plugin.extractTestStructure!('/project/TestParser.java', code);
      expect(result).not.toBeNull();
      expect(result!.testCases[0].assertionCount).toBeGreaterThanOrEqual(3);
    });

    it('detects @Ignore-skipped tests (JUnit 4)', () => {
      const code = `
import org.junit.Test;
import org.junit.Ignore;
public class FooTest {
  @Test
  public void testOk() { Assert.assertTrue(true); }
  @Ignore
  @Test
  public void testSkipped() { Assert.assertTrue(false); }
}`;
      const result = plugin.extractTestStructure!('/project/FooTest.java', code);
      expect(result).not.toBeNull();
      const skipped = result!.testCases.filter((tc) => tc.isSkipped);
      expect(skipped).toHaveLength(1);
      expect(skipped[0].name).toBe('testSkipped');
    });

    it('detects @Disabled-skipped tests (JUnit 5)', () => {
      const code = `
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Disabled;
public class FooTest {
  @Test
  public void testOk() { Assertions.assertTrue(true); }
  @Disabled("not ready")
  @Test
  public void testSkipped() { }
}`;
      const result = plugin.extractTestStructure!('/project/FooTest.java', code);
      expect(result).not.toBeNull();
      const skipped = result!.testCases.filter((tc) => tc.isSkipped);
      expect(skipped).toHaveLength(1);
      expect(skipped[0].name).toBe('testSkipped');
    });

    it('sets testTypeHint to unit for JUnit tests', () => {
      const code = `
import org.junit.Test;
public class FooTest {
  @Test
  public void testFoo() { Assert.assertTrue(true); }
}`;
      const result = plugin.extractTestStructure!('/project/FooTest.java', code);
      expect(result!.testTypeHint).toBe('unit');
    });

    it('returns null when no known test framework is detected', () => {
      const code = `
package com.example;
public class RegularClass {
  public void doStuff() { }
}`;
      const result = plugin.extractTestStructure!('/project/RegularClass.java', code);
      expect(result).toBeNull();
    });

    it('extracts @Benchmark methods as test cases', () => {
      const code = `
import org.openjdk.jmh.annotations.*;
public class TensorBench {
  @Benchmark
  public void benchMatmul(Blackhole bh) { bh.consume(result); }
  @Benchmark
  public void benchDot(Blackhole bh) { bh.consume(result2); }
}`;
      const result = plugin.extractTestStructure!('/project/TensorBench.java', code);
      expect(result).not.toBeNull();
      expect(result!.testCases).toHaveLength(2);
    });
  });

  describe('extractTestStructure - importedSourceFiles', () => {
    it('converts project class imports to relative file paths', () => {
      const code = `
import org.junit.Test;
import org.junit.Assert;
import com.github.tjake.jlama.tensor.AbstractTensor;
import com.github.tjake.jlama.tensor.FloatBufferTensor;
import com.github.tjake.jlama.safetensors.SafeTensorSupport;
public class TestParser {
  @Test
  public void testSomething() { Assert.assertEquals(1, 1); }
}`;
      const result = plugin.extractTestStructure!('/project/TestParser.java', code);
      expect(result).not.toBeNull();
      expect(result!.importedSourceFiles).toContain('com/github/tjake/jlama/tensor/AbstractTensor.java');
      expect(result!.importedSourceFiles).toContain('com/github/tjake/jlama/tensor/FloatBufferTensor.java');
      expect(result!.importedSourceFiles).toContain('com/github/tjake/jlama/safetensors/SafeTensorSupport.java');
    });

    it('excludes stdlib and test framework imports', () => {
      const code = `
import org.junit.Test;
import org.junit.Assert;
import org.assertj.core.api.Assertions;
import java.util.List;
import java.io.IOException;
import javax.annotation.Nullable;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.example.MyProjectClass;
public class MyTest {
  @Test
  public void testSomething() { Assert.assertEquals(1, 1); }
}`;
      const result = plugin.extractTestStructure!('/project/MyTest.java', code);
      expect(result).not.toBeNull();
      expect(result!.importedSourceFiles).not.toContain('org/junit/Test.java');
      expect(result!.importedSourceFiles).not.toContain('org/junit/Assert.java');
      expect(result!.importedSourceFiles).not.toContain('org/assertj/core/api/Assertions.java');
      expect(result!.importedSourceFiles).not.toContain('java/util/List.java');
      expect(result!.importedSourceFiles).not.toContain('javax/annotation/Nullable.java');
      expect(result!.importedSourceFiles).not.toContain('com/fasterxml/jackson/databind/ObjectMapper.java');
      expect(result!.importedSourceFiles).toContain('com/example/MyProjectClass.java');
    });

    it('extracts static imports from project classes', () => {
      const code = `
import org.junit.Test;
import static com.github.tjake.jlama.tensor.operations.NativeSimdTensorOperations.*;
public class TestOperations {
  @Test
  public void testOps() { assertEquals(1, 1); }
}`;
      const result = plugin.extractTestStructure!('/project/TestOperations.java', code);
      expect(result).not.toBeNull();
      expect(result!.importedSourceFiles).toContain(
        'com/github/tjake/jlama/tensor/operations/NativeSimdTensorOperations.java'
      );
    });

    it('excludes static imports from test frameworks', () => {
      const code = `
import org.junit.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.Assert.assertEquals;
import com.example.MyService;
public class MyServiceTest {
  @Test
  public void testService() { assertThat(1).isEqualTo(1); }
}`;
      const result = plugin.extractTestStructure!('/project/MyServiceTest.java', code);
      expect(result).not.toBeNull();
      expect(result!.importedSourceFiles).not.toContain('org/assertj/core/api/Assertions.java');
      expect(result!.importedSourceFiles).not.toContain('org/junit/Assert.java');
      expect(result!.importedSourceFiles).toContain('com/example/MyService.java');
    });

    it('resolves static method imports to the containing class file', () => {
      const code = `
import org.junit.jupiter.api.Test;
import static com.github.tjake.jlama.net.grpc.JlamaService.isPowerOfTwoUsingBitwiseOperation;
import static com.github.tjake.jlama.net.grpc.JlamaService.nextPowerOfTwo;
public class JlamaServiceUnitTest {
  @Test
  public void testPowerOfTwo() { }
}`;
      const result = plugin.extractTestStructure!('/project/JlamaServiceUnitTest.java', code);
      expect(result).not.toBeNull();
      expect(result!.importedSourceFiles).toContain(
        'com/github/tjake/jlama/net/grpc/JlamaService.java'
      );
      // Should only appear once (deduped)
      const count = result!.importedSourceFiles.filter(
        (f) => f === 'com/github/tjake/jlama/net/grpc/JlamaService.java'
      ).length;
      expect(count).toBe(1);
    });

    it('returns empty importedSourceFiles when all imports are external', () => {
      const code = `
import org.junit.Test;
import java.util.List;
import org.slf4j.Logger;
public class PureFrameworkTest {
  @Test
  public void testSomething() { }
}`;
      const result = plugin.extractTestStructure!('/project/PureFrameworkTest.java', code);
      expect(result).not.toBeNull();
      expect(result!.importedSourceFiles).toHaveLength(0);
    });
  });
});
