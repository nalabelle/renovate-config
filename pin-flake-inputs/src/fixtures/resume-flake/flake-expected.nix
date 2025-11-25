{
  inputs = {
    # renovate: depName=NixOS/nixpkgs branch=nixos-unstable
    nixpkgs.url = "github:NixOS/nixpkgs/dfb2f12e899db4876308eba6d93455ab7da304cd";
    # renovate: depName=hercules-ci/flake-parts
    flake-parts.url = "github:hercules-ci/flake-parts/af66ad14b28a127c5c0f3bbb298218fc63528a18";
    git-hooks = {
      # renovate: depName=cachix/git-hooks.nix
      url = "github:cachix/git-hooks.nix/e891a93b193fcaf2fc8012d890dc7f0befe86ec2";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    dotfiles = {
      # renovate: depName=nalabelle/dotfiles
      url = "github:nalabelle/dotfiles/32b1fcda7be9c5b93bb578b795b19769200aa3bd";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    resume-builder = {
      # renovate: url=git+https://git.oops.city/nalabelle/resume-builder branch=refs/heads/main
      url = "git+https://git.oops.city/nalabelle/resume-builder?rev=95c6fcd664c6f0690ac09e1474a224c71b96d81c";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { };
}
