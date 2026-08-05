; Top-level free functions. Class methods are excluded because their
; function_declarator name is a field_identifier (not an identifier), and
; out-of-class qualified definitions (Foo::bar) are excluded because their
; declarator is a qualified_identifier.
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @function.name)) @function.node
