

This is a library for interacting with TREB spreadsheets with arbitrary
LLMs. It's a fork of the library originally written for RiskAMP web. Tool
definitions and many of the implementations were originally written by
Claude code.

The LLM chat machinery (streaming, tool-call loop, models, markdown) is in
llm-support-core (git@github.com:trebco/llm-support-core.git), linked as
`file:../llm-support-core`; this library adds the TREB spreadsheet tools on
top and re-exports it. Check out llm-support-core (and TREB) next to this
repo, then `npm install`.


