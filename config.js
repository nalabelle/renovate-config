var config = {
  "platform": "forgejo",
  "endpoint": "https://git.oops.city",
  // Invite Renovate user to repos to get updates
  "autodiscover": true,
  "useCloudMetadataServices": false,
  "hostRules": [
    {
      "hostType": "github",
      "token": process.env.GITHUB_TOKEN,
    },
  ],
};

export default config;
