package main

import (
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

func main() {
	s := server.NewMCPServer("test-server", "1.0.0")
	s.AddTool(mcp.NewTool("list_files", mcp.WithDescription("List files")), listFilesHandler)
	s.AddTool(mcp.NewTool("read_file", mcp.WithDescription("Read file")), readFileHandler)
	server.ServeStdio(s)
}
