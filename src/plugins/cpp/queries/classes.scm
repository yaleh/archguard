; Classes and structs. Template specializations are naturally excluded: their
; `name` field is a template_type, not a type_identifier.
(class_specifier
  name: (type_identifier)) @class.specifier

(struct_specifier
  name: (type_identifier)) @class.specifier
