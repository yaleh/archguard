module github.com/example/complex-project

go 1.22

require (
    github.com/gin-gonic/gin v1.9.0
    github.com/golang-migrate/migrate/v4 v4.16.2
    github.com/spf13/cobra v1.8.0
    golang.org/x/tools v0.15.0 // indirect
    gopkg.in/yaml.v3 v3.0.1 // indirect
)

require (
    github.com/mattn/go-sqlite3 v1.14.19 // indirect
    github.com/google/uuid v1.5.0
)

exclude github.com/bad/module v1.0.0

replace github.com/old/module => github.com/new/module v1.2.0

retract v1.0.0 // retract for security issue
