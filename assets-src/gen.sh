#!/bin/bash
# usage: gen.sh NAME ASPECT RES PROMPTFILE [ref images...]
name=$1; ar=$2; res=$3; pf=$4; shift 4
refs=(); for r in "$@"; do refs+=(--image "$r"); done
higgsfield generate create nano_banana_pro --prompt "$(cat $pf)" --aspect_ratio $ar --resolution $res "${refs[@]}" --wait --wait-timeout 15m --json > $name.json 2> $name.err || { echo "FAIL $name: $(head -3 $name.err)"; exit 1; }
u=$(python3 -c "import json;print(json.load(open('$name.json'))[0]['result_url'])")
curl -s -o $name.png "$u" && echo "OK $name"
