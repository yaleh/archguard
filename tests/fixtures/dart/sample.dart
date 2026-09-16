import 'dart:core';
import 'sample_adjacent.dart';

abstract class Animal {
  final String name;
  int age = 0;

  Animal(this.name);
  Animal.named(this.name, this.age);
  Animal.optional({required this.name, this.age = 1});

  String speak() => '...';
  int get nameLength => name.length;
}

class Logger {
  void log() {}
}

mixin Walker {
  void walk() {}
}

class Dog extends Animal with Walker implements Logger {
  Logger logger = Logger();
  // Cross-file relation: AdjacentHelper is defined in sample_adjacent.dart.
  AdjacentHelper helper = AdjacentHelper();

  factory Dog.fromJson(Map<String, dynamic> json) => Dog(json['name']);

  String bark(int times) {
    return 'woof';
  }

  void greet({required String name, int count = 1}) {}
}

enum Color { red, green, blue }

// Enhanced enum — declares fields, a constructor, a getter, and a method
// after the `;`. These must be extracted, not just the enum constants.
enum HttpStatus {
  ok(200),
  notFound(404);

  const HttpStatus(this.code);
  final int code;

  bool get isSuccess => code < 400;
  String describe() => 'status $code';
}

extension StringX on String {
  String get doubled => this + this;
}

// Anonymous extension — must get a stable synthetic identity, not empty name.
extension on int {
  int get squared => this * this;
}
