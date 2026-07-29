//! MCP Gateway Module
//!
//! Provides a lazy-loading MCP gateway server that exposes meta-tools for
//! discovering and connecting to backend MCPs on demand. This reduces context
//! pollution by only loading tools when explicitly requested.

pub mod backend;
pub mod server;
pub mod tools;

pub use server::GatewayServerState;
