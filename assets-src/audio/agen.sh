#!/bin/bash
# usage: agen.sh NAME "prompt" [extra flags...]
name=$1; prompt=$2; shift 2
higgsfield generate create seed_audio --prompt "$prompt" --format wav --sample_rate 44100 "$@" --wait --wait-timeout 10m --json > $name.json 2> $name.err || { echo "FAIL $name: $(head -2 $name.err)"; exit 1; }
u=$(python3 -c "import json;print(json.load(open('$name.json'))[0]['result_url'])")
curl -s -o $name.wav "$u" && afconvert -f m4af -d aac -b 96000 -c 1 $name.wav /Users/josegaelcruzlopez/Desktop/hackmit/public/assets/audio/$name.m4a && echo "OK $name"
