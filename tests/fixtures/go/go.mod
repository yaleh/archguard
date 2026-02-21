module github.com/example/project

go 1.21

require (
    github.com/gin-gonic/gin v1.9.0
    golang.org/x/tools v0.15.0 // indirect
    github.com/stretchr/testify v1.8.4
    gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/old/module => ../local/module
