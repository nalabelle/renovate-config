{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    dotfiles = {
      url = "github:nalabelle/dotfiles";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    resume-builder = {
      url = "git+https://git.oops.city/nalabelle/resume-builder";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { };
}
