; Field declarations inside class/struct bodies. The declarator may be a plain
; field_identifier or a wrapper (pointer/reference/array/qualified); the mapper
; resolves the name and pointer/reference sigil from the declarator node.
(field_declaration
  type: _
  declarator: (_)) @field.node
