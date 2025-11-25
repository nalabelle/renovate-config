{
  description = "Pin Nix flake inputs to commits from flake.lock for Renovate tracking";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = false;
          };
        };

        node = pkgs.nodejs_24;
      in
      {
        # Package that builds the TypeScript project and exposes a CLI.
        packages.default = pkgs.buildNpmPackage {
          pname = "pin-flake-inputs";
          version = "0.0.0";

          src = ./.;

          npmDepsHash = "sha256-iebMLB4bMq9QQ9XHGsGff/sDLOUtP5j+dbfzmDELgTA=";

          buildInputs = [
            node
          ];

          npmBuildScript = "build";

          installPhase = ''
            runHook preInstall

            mkdir -p "$out/bin"
            mkdir -p "$out/lib/node_modules/pin-flake-inputs"

            cp -r dist "$out/lib/node_modules/pin-flake-inputs/"
            cp -r node_modules "$out/lib/node_modules/pin-flake-inputs/"
            cp package.json "$out/lib/node_modules/pin-flake-inputs/"

            cat >"$out/bin/pin-flake-inputs" <<EOF
            #!${pkgs.bash}/bin/bash
            exec ${node}/bin/node "$out/lib/node_modules/pin-flake-inputs/dist/main.js" "\$@"
            EOF

            chmod +x "$out/bin/pin-flake-inputs"

            runHook postInstall
          '';
        };

        apps.default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/pin-flake-inputs";
        };

        # Export dev/build tooling so the root flake can reuse it instead of
        # hard-coding nodejs_24 there.
        devTools = {
          inherit node;
        };
      }
    );
}
