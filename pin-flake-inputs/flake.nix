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
        packages.default =
          let
            npmPackage = pkgs.buildNpmPackage {
              pname = "pin-flake-inputs";
              version = "0.0.0";

              src = ./.;

              npmDepsHash = "sha256-g1agFCCJDGOPNVJZjM9y6PffZxtJA5jXoUMCgCHnvOI=";

              buildInputs = [ node ];

              npmBuildScript = "build";

              installPhase = ''
                runHook preInstall

                mkdir -p "$out/lib/node_modules/pin-flake-inputs"

                cp -r dist "$out/lib/node_modules/pin-flake-inputs/"
                cp -r node_modules "$out/lib/node_modules/pin-flake-inputs/"
                cp package.json "$out/lib/node_modules/pin-flake-inputs/"

                runHook postInstall
              '';
            };
          in
          pkgs.writeShellApplication {
            name = "pin-flake-inputs";
            runtimeInputs = with pkgs; [
              bash
              coreutils
              gitMinimal
              nix
              node
              renovate
            ];
            text = ''
              exec ${node}/bin/node "${npmPackage}/lib/node_modules/pin-flake-inputs/dist/main.js" "$@"
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
