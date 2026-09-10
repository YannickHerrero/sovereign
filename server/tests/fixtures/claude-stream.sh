#!/bin/sh
# Minimal stand-in for `claude -p --input-format stream-json --output-format stream-json`.
# One user message produces: init, a Write tool call, a text reply streamed as one delta, result.
while IFS= read -r line; do
    case "$line" in
        *'"type":"control_request"'*)
            id=${line#*\"request_id\":\"}
            id=${id%%\"*}
            case "$line" in
                *'"subtype":"interrupt"'*|*'"subtype":"set_model"'*)
                    printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{}}}\n' "$id" ;;
                *)
                    printf '{"type":"control_response","response":{"subtype":"error","request_id":"%s","error":"unsupported"}}\n' "$id" ;;
            esac ;;
        *'"type":"user"'*)
            printf '{"type":"system","subtype":"init","session_id":"s","model":"claude-sonnet-5","tools":["Bash","Edit","Write"]}\n'
            printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"tu1","name":"Write","input":{"file_path":"/tmp/x/hello.md","content":"hello"}}]}}\n'
            printf '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu1","content":"ok"}]}}\n'
            printf '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}\n'
            printf '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}}\n'
            printf '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n'
            printf '{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","terminal_reason":"completed","result":"done","session_id":"s"}\n' ;;
    esac
done
