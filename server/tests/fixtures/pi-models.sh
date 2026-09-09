#!/bin/sh
# Minimal RPC peer for model tests. Fails unless provider + modelId are sent correctly.
while IFS= read -r line; do
    id=${line#*\"id\":\"}
    id=${id%%\"*}
    case "$line" in
        *'"type":"get_available_models"'*)
            data='{"models":[{"provider":"test","id":"vision","name":"Vision","input":["text","image"]},{"provider":"other","id":"vision","name":"Other vision","input":["text"]}]}' ;;
        *'"type":"get_state"'*)
            streaming=false
            if [ -f working ]; then streaming=true; fi
            data='{"model":{"provider":"test","id":"vision","name":"Vision","input":["text","image"]},"isStreaming":'"$streaming"'}' ;;
        *'"type":"set_model"'*)
            case "$line" in
                *'"modelId":"vision"'*'"provider":"test"'*)
                    data='{"provider":"test","id":"vision","name":"Vision","input":["text","image"]}' ;;
                *) printf '{"id":"%s","type":"response","success":false,"error":"Model not found"}\n' "$id"; continue ;;
            esac ;;
        *) printf '{"id":"%s","type":"response","success":false,"error":"Unknown command"}\n' "$id"; continue ;;
    esac
    printf '{"id":"%s","type":"response","success":true,"data":%s}\n' "$id" "$data"
done
