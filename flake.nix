{
  description = "Infrastructure development environment";

  inputs = {
    # depName=NixOS/nixpkgs branch=nixos-unstable
    nixpkgs.url = "github:NixOS/nixpkgs/c5ae371f1a6a7fd27823bc500d9390b38c05fa55";
    # depName=numtide/flake-utils
    flake-utils.url = "github:numtide/flake-utils/11707dc2f618dd54ca8739b309ec4fc024de578b";
    # depName=cachix/git-hooks.nix
    git-hooks.url = "github:cachix/git-hooks.nix/7275fa67fbbb75891c16d9dee7d88e58aea2d761";
    pin-flake-inputs.url = "path:./pin-flake-inputs";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }@inputs:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };
      in
      {
        # Wrap renovate with its dependencies
        packages.renovate-wrapped = pkgs.writeShellApplication {
          name = "renovate";
          runtimeInputs = with pkgs; [
            bash
            cargo
            coreutils
            curl
            gitMinimal
            gnumake
            nix
            nixos-rebuild
            nodejs_latest
            openssh
            renovate
            wget
          ];
          text = ''
            export RENOVATE_CONFIG_FILE="''${RENOVATE_CONFIG_FILE:-config.js}"
            exec ${pkgs.renovate}/bin/renovate "$@"
          '';
        };

        # TypeScript implementation of pin-flake-inputs
        packages.pin-flake-inputs = inputs.pin-flake-inputs.packages.${system}.default;

        # App for running pin-flake-inputs
        apps.pin-flake-inputs = {
          type = "app";
          program = "${self.packages.${system}.pin-flake-inputs}/bin/pin-flake-inputs";
        };

        # Run the hooks with `nix fmt`.
        formatter = (
          let
            config = self.checks.${system}.pre-commit-check.config;
            inherit (config) package configFile;
            script = ''
              ${package}/bin/pre-commit run --all-files --config ${configFile}
            '';
          in
          pkgs.writeShellScriptBin "pre-commit-run" script
        );

        # Run the hooks in a sandbox with `nix flake check`.
        # Read-only filesystem and no internet access.
        # https://github.com/cachix/git-hooks.nix#hooks
        checks = {
          pre-commit-check = inputs.git-hooks.lib.${system}.run {
            src = ./.;
            hooks = {
              fix-byte-order-marker.enable = true;
              check-case-conflicts.enable = true;
              check-executables-have-shebangs.enable = true;
              end-of-file-fixer.enable = true;
              mixed-line-endings.enable = true;
              trim-trailing-whitespace.enable = true;
              check-shebang-scripts-are-executable = {
                enable = true;
                excludes = [ "\.j2$" ];
              };
              check-symlinks.enable = true;
              check-merge-conflicts.enable = true;

              check-json.enable = true;
              check-yaml = {
                enable = true;
                args = [ "--allow-multiple-documents" ];
              };
              check-toml.enable = true;
              shellcheck.enable = true;

              # Custom hooks from jumanjihouse/pre-commit-hooks
              forbid-binary = {
                name = "forbid-binary";
                description = "Forbid binary files from being committed";
                entry =
                  let
                    script = pkgs.writeShellScript "forbid-binary" ''
                      set -e
                      for file in "$@"; do
                        if [[ -f "$file" ]] && ! file --mime-encoding "$file" | grep -q 'us-ascii\|utf-8'; then
                          echo "Binary file detected: $file"
                          exit 1
                        fi
                      done
                    '';
                  in
                  "${script}";
                language = "system";
                types = [ "file" ];
              };

              script-must-have-extension = {
                name = "script-must-have-extension";
                description = "Ensure that executable scripts have file extensions";
                entry =
                  let
                    script = pkgs.writeShellScript "script-must-have-extension" ''
                      set -e
                      for file in "$@"; do
                        if [[ -x "$file" ]] && [[ ! "$file" =~ \. ]]; then
                          echo "Executable script without extension: $file"
                          exit 1
                        fi
                      done
                    '';
                  in
                  "${script}";
                language = "system";
                types = [ "executable" ];
                excludes = [ "\.envrc$" ];
              };

              script-must-not-have-extension = {
                name = "script-must-not-have-extension";
                description = "Ensure that non-executable scripts do not have file extensions";
                entry =
                  let
                    script = pkgs.writeShellScript "script-must-not-have-extension" ''
                      set -e
                      for file in "$@"; do
                        if [[ ! -x "$file" ]] && [[ "$file" =~ ^[^/]*\.[^/]*$ ]] && file --mime-type "$file" | grep -q 'text/x-shellscript\|text/x-script'; then
                          echo "Non-executable script with extension: $file"
                          exit 1
                        fi
                      done
                    '';
                  in
                  "${script}";
                language = "system";
                types = [ "text" ];
              };

              nixfmt-rfc-style.enable = true;
            };
          };
        };

        devShells.default = pkgs.mkShell {
          inherit (self.checks.${system}.pre-commit-check) shellHook enabledPackages;
          RENOVATE_CONFIG_FILE = "config.js";
          LOG_LEVEL = "INFO";

          buildInputs = with pkgs; [
            pre-commit
            prettier
            (inputs.pin-flake-inputs.devTools.${system}.node)

            self.packages.${system}.renovate-wrapped
            self.packages.${system}.pin-flake-inputs
          ];
        };
      }
    );
}
