{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    dotfiles = {
      url = "github:nalabelle/dotfiles";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-parts.follows = "flake-parts";
    };
    audiocheck-rs = {
      url = "path:./audiocheck-rs";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Beets plugins
    beets-importreplace = {
      url = "github:edgars-supe/beets-importreplace";
      flake = false;
    };
  };

  outputs = { };
}
