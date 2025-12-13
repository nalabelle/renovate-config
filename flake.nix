{
  description = "Infrastructure development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    flake-utils.url = "github:numtide/flake-utils";
    dotfiles = {
      url = "github:nalabelle/dotfiles";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-parts.follows = "flake-parts";
    };
    pin-flake-inputs.url = "path:./pin-flake-inputs";
    renovate-source = {
      # Shallow clone
      url = "git+https://github.com/renovatebot/renovate?shallow=1";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-parts,
      ...
    }@inputs:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ inputs.dotfiles.flakeModules.pre-commit ];
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      perSystem =
        {
          pkgs,
          config,
          lib,
          system,
          ...
        }:
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

          devShells.default = pkgs.mkShell {
            inputsFrom = [ config.devShells.pre-commit ];
            RENOVATE_CONFIG_FILE = "config.js";
            LOG_LEVEL = "INFO";

            buildInputs = with pkgs; [
              pre-commit
              prettier

              self.packages.${system}.renovate-wrapped
            ];

            shellHook = ''
              echo "Dev environment loaded."

              # Create symlinks to flake inputs for reference
              KB="knowledge-base"
              mkdir -p "$KB"
              ln -sfn ${inputs.renovate-source} "$KB/renovate-source"
              echo "Renovate source available at $KB/renovate-source/"
              echo "Remember to use trailing slashes to access knowledge base symlinks."
            '';
          };
        };
    };
}
