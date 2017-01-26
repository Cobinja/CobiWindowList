#! //usr/bin/env bash

for f in po/*.po
do
  namebase=$(basename "$f")
  filename="${namebase%.*}"
  echo "Compiling $namebase to $filename.mo"
  msgfmt -c $f -o $HOME/.local/share/locale/$filename/LC_MESSAGES/windowlist@cobinja.de.mo
done
