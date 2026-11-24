#!/bin/zsh
cd "${0:A:h}" || exit 1
if ! command -v node >/dev/null && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
fi
if curl --silent --fail --max-time 1 http://127.0.0.1:47381/ >/dev/null; then
  echo "Sunshine Tabs is running at http://127.0.0.1:47381/"
  exit 0
fi
exec node server.mjs
