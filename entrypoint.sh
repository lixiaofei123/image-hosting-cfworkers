#!/bin/bash

BUCKET_NAME=$BUCKET_NAME
PASSWORD=$PASSWORD
SIGN_KEY=$SIGN_KEY


if [ -n "$PASSWORD" ]; then
    sed -i "s/PASSWORD = .*/PASSWORD = \"$PASSWORD\"/" wrangler.toml
fi

if [ -n "$SIGN_KEY" ]; then
    sed -i "s/SIGN_KEY = .*/SIGN_KEY = \"$SIGN_KEY\"/" wrangler.toml
fi

node_modules/wrangler/bin/wrangler.js dev --port 8080 --ip 0.0.0.0
