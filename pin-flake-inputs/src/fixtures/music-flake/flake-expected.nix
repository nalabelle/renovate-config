{
  inputs = {
    # depName=NixOS/nixpkgs branch=nixos-unstable
    nixpkgs.url = "github:NixOS/nixpkgs/b6a8526db03f735b89dd5ff348f53f752e7ddc8e";
    # depName=hercules-ci/flake-parts
    flake-parts.url = "github:hercules-ci/flake-parts/26d05891e14c88eb4a5d5bee659c0db5afb609d8";
    dotfiles = {
      # depName=nalabelle/dotfiles
      url = "github:nalabelle/dotfiles/1ff3798f4b98e6db8f36ac9e975a4a1b4cc02959";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-parts.follows = "flake-parts";
    };
    audiocheck-rs = {
      url = "path:./audiocheck-rs";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Beets plugins
    beets-importreplace = {
      # depName=edgars-supe/beets-importreplace
      url = "github:edgars-supe/beets-importreplace/2069316c288719bd5f814d7dee6f02a2ad480b86";
      flake = false;
    };
  };

  outputs = { };
}
