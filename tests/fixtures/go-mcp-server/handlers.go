package main

import (
	"context"

	"github.com/mark3labs/mcp-go/mcp"
)

func listFilesHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return mcp.NewToolResultText("[]"), nil
}

func readFileHandler(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return mcp.NewToolResultText(""), nil
}
