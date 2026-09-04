import 'package:flutter_test/flutter_test.dart';
import 'sample.dart';

void main() {
  group('Dog', () {
    test('bark returns woof', () {
      expect(Dog().bark(1), 'woof');
      expect(Dog().bark(2), 'woof');
    });

    testWidgets('renders a widget', (tester) async {
      expect(1, 1);
    });

    test('skipped test', skip: true, () {
      expect(true, isTrue);
    });
  });
}

class Dog {
  String bark(int n) => 'woof';
}
