/**
 * Copyright 2013-2017 the original author or authors from the JHipster project.
 *
 * This file is part of the JHipster project, see http://www.jhipster.tech/
 * for more information.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const fs = require('fs');
const exec = require('child_process').exec;
const chalk = require('chalk');
const _ = require('lodash');
const glob = require('glob');
const BaseGenerator = require('../generator-base');

const constants = require('../generator-constants');

module.exports = class extends BaseGenerator {
    initializing() {
        this.log(chalk.bold('Heroku configuration is starting'));
        this.env.options.appPath = this.config.get('appPath') || constants.CLIENT_MAIN_SRC_DIR;
        this.baseName = this.config.get('baseName');
        this.packageName = this.config.get('packageName');
        this.packageFolder = this.config.get('packageFolder');
        this.cacheProvider = this.config.get('cacheProvider');
        this.databaseType = this.config.get('databaseType');
        this.prodDatabaseType = this.config.get('prodDatabaseType');
        this.angularAppName = this.getAngularAppName();
        this.buildTool = this.config.get('buildTool');
        this.applicationType = this.config.get('applicationType');
        this.serviceDiscoveryType = this.config.get('serviceDiscoveryType');
        this.herokuAppName = this.config.get('herokuAppName');
        this.dynoSize = 'Free';
    }

    prompting() {
        const done = this.async();

        if (this.herokuAppName) {
            exec('heroku apps:info --json', (err, stdout) => {
                if (err) {
                    this.config.set('herokuAppName', null);
                    this.abort = true;
                    this.log.error(`Could not find app: ${chalk.cyan(this.herokuAppName)}`);
                    this.log.error('Run the generator again to create a new app.');
                } else {
                    const json = JSON.parse(stdout);
                    this.herokuAppName = json.app.name;
                    if (json.dynos.length > 0) {
                        this.dynoSize = json.dynos[0].size;
                    }
                    this.log(`Deploying as existing app: ${chalk.bold(this.herokuAppName)}`);
                    this.herokuAppExists = true;
                    this.config.set('herokuAppName', this.herokuAppName);
                }
                done();
            });
        } else {
            const prompts = [
                {
                    type: 'input',
                    name: 'herokuAppName',
                    message: 'Name to deploy as:',
                    default: this.baseName
                },
                {
                    type: 'list',
                    name: 'herokuRegion',
                    message: 'On which region do you want to deploy ?',
                    choices: ['us', 'eu'],
                    default: 0
                }];

            this.prompt(prompts).then((props) => {
                this.herokuAppName = _.kebabCase(props.herokuAppName);
                this.herokuRegion = props.herokuRegion;
                this.herokuAppExists = false;
                done();
            });
        }
    }

    get configuring() {
        return {
            checkInstallation() {
                if (this.abort) return;
                const done = this.async();

                exec('heroku --version', (err) => {
                    if (err) {
                        this.log.error('You don\'t have the Heroku Toolbelt installed. ' +
                            'Download it from https://toolbelt.heroku.com/');
                        this.abort = true;
                    }
                    done();
                });
            }
        };
    }

    get default() {
        return {
            insight() {
                const insight = this.insight();
                insight.trackWithEvent('generator', 'heroku');
            },

            gitInit() {
                if (this.abort) return;
                const done = this.async();

                try {
                    fs.lstatSync('.git');
                    this.log(chalk.bold('\nUsing existing Git repository'));
                    done();
                } catch (e) {
                    // An exception is thrown if the folder doesn't exist
                    this.log(chalk.bold('\nInitializing Git repository'));
                    const child = exec('git init', {}, (err, stdout, stderr) => {
                        done();
                    });
                    child.stdout.on('data', (data) => {
                        this.log(data.toString());
                    });
                }
            },

            installHerokuDeployPlugin() {
                if (this.abort) return;
                const done = this.async();
                const cliPlugin = 'heroku-cli-deploy';

                exec('heroku plugins', (err, stdout) => {
                    if (_.includes(stdout, cliPlugin)) {
                        this.log('\nHeroku CLI deployment plugin already installed');
                        done();
                    } else {
                        this.log(chalk.bold('\nInstalling Heroku CLI deployment plugin'));
                        const child = exec(`heroku plugins:install ${cliPlugin}`, (err, stdout) => {
                            if (err) {
                                this.abort = true;
                                this.log.error(err);
                            }

                            done();
                        });

                        child.stdout.on('data', (data) => {
                            this.log(data.toString());
                        });
                    }
                });
            },

            herokuCreate() {
                if (this.abort || this.herokuAppExists) return;
                const done = this.async();

                const regionParams = (this.herokuRegion !== 'us') ? ` --region ${this.herokuRegion}` : '';

                this.log(chalk.bold('\nCreating Heroku application and setting up node environment'));
                let herokuCreateCmd = `heroku create ${this.herokuAppName}${regionParams}`;
                this.log(herokuCreateCmd);

                const child = exec(herokuCreateCmd, {}, (err, stdout, stderr) => {
                    if (err) {
                        if (stderr.includes('Name is already taken')) {
                            const prompts = [
                                {
                                    type: 'list',
                                    name: 'herokuForceName',
                                    message: `The Heroku app "${chalk.cyan(this.herokuAppName)}" already exists! Use it anyways?`,
                                    choices: [{
                                        value: 'Yes',
                                        name: 'Yes, I have access to it'
                                    }, {
                                        value: 'No',
                                        name: 'No, generate a random name'
                                    }],
                                    default: 0
                                }];

                            this.log('');
                            this.prompt(prompts).then((props) => {
                                let getHerokuAppName = def => def;
                                if (props.herokuForceName === 'Yes') {
                                    herokuCreateCmd = `heroku git:remote --app ${this.herokuAppName}`;
                                } else {
                                    herokuCreateCmd = `heroku create ${regionParams}`;

                                    // Extract from "Created random-app-name-1234... done"
                                    getHerokuAppName = (def, stdout) => stdout.substring(stdout.indexOf('https://') + 8, stdout.indexOf('.herokuapp'));
                                }
                                exec(herokuCreateCmd, {}, (err, stdout, stderr) => {
                                    if (err) {
                                        this.abort = true;
                                        this.log.error(err);
                                    } else {
                                        this.herokuAppName = getHerokuAppName(this.herokuAppName, stdout);
                                        this.log(stdout.trim());
                                    }
                                    this.config.set('herokuAppName', this.herokuAppName);
                                    done();
                                });
                            });
                        } else {
                            this.abort = true;
                            this.log.error(err);
                            done();
                        }
                    } else {
                        done();
                    }
                });

                child.stdout.on('data', (data) => {
                    const output = data.toString();
                    if (data.search('Heroku credentials') >= 0) {
                        this.abort = true;
                        this.log.error('Error: Not authenticated. Run \'heroku login\' to login to your heroku account and try again.');
                        done();
                    } else {
                        this.log(output.trim());
                    }
                });
            },

            herokuAddonsCreate() {
                if (this.abort) return;
                const done = this.async();

                let dbAddOn = '';
                if (this.prodDatabaseType === 'postgresql') {
                    dbAddOn = 'heroku-postgresql --as DATABASE';
                } else if (this.prodDatabaseType === 'mysql') {
                    dbAddOn = 'jawsdb:kitefin --as DATABASE';
                } else if (this.prodDatabaseType === 'mariadb') {
                    dbAddOn = 'jawsdb-maria:kitefin --as DATABASE';
                } else if (this.prodDatabaseType === 'mongodb') {
                    dbAddOn = 'mongolab:sandbox --as MONGODB';
                } else {
                    return;
                }

                this.log(chalk.bold('\nProvisioning addons'));
                exec(`heroku addons:create ${dbAddOn} --app ${this.herokuAppName}`, {}, (err, stdout, stderr) => {
                    if (err) {
                        const verifyAccountUrl = 'https://heroku.com/verify';
                        if (_.includes(err, verifyAccountUrl)) {
                            this.abort = true;
                            this.log.error(`Account must be verified to use addons. Please go to: ${verifyAccountUrl}`);
                            this.log.error(err);
                        } else {
                            this.log('No new addons created');
                        }
                    } else {
                        this.log(`Created ${dbAddOn}`);
                    }
                    done();
                });
            },

            configureJHipsterRegistry() {
                if (this.abort || this.herokuAppExists) return;
                const done = this.async();

                if (this.serviceDiscoveryType === 'eureka') {
                    const prompts = [
                        {
                            type: 'input',
                            name: 'herokuJHipsterRegistry',
                            message: 'What is the URL of your JHipster Registry?'
                        }];

                    this.log('');
                    this.prompt(prompts).then((props) => {
                        const configSetCmd = `heroku config:set JHIPSTER_REGISTRY_URL=${props.herokuJHipsterRegistry} --app ${this.herokuAppName}`;
                        const child = exec(configSetCmd, {}, (err, stdout, stderr) => {
                            if (err) {
                                this.abort = true;
                                this.log.error(err);
                            }
                            done();
                        });

                        child.stdout.on('data', (data) => {
                            this.log(data.toString());
                        });
                    });
                } else {
                    this.conflicter.resolve((err) => {
                        done();
                    });
                }
            },

            copyHerokuFiles() {
                if (this.abort) return;

                const done = this.async();
                this.log(chalk.bold('\nCreating Heroku deployment files'));

                this.template('_bootstrap-heroku.yml', `${constants.SERVER_MAIN_RES_DIR}/config/bootstrap-heroku.yml`);
                this.template('_application-heroku.yml', `${constants.SERVER_MAIN_RES_DIR}/config/application-heroku.yml`);
                this.template('_Procfile', 'Procfile');
                if (this.buildTool === 'gradle') {
                    this.template('_heroku.gradle', 'gradle/heroku.gradle');
                }

                this.conflicter.resolve((err) => {
                    done();
                });
            },

            addHerokuDependencies() {
                if (this.buildTool === 'maven') {
                    this.addMavenDependency('org.springframework.cloud', 'spring-cloud-localconfig-connector');
                    this.addMavenDependency('org.springframework.cloud', 'spring-cloud-heroku-connector');
                } else if (this.buildTool === 'gradle') {
                    this.addGradleDependency('compile', 'org.springframework.cloud', 'spring-cloud-localconfig-connector');
                    this.addGradleDependency('compile', 'org.springframework.cloud', 'spring-cloud-heroku-connector');
                }
            },

            addHerokuBuildPlugin() {
                if (this.buildTool !== 'gradle') return;
                this.addGradlePlugin('gradle.plugin.com.heroku.sdk', 'heroku-gradle', '0.2.0');
                this.applyFromGradleScript('gradle/heroku');
            }
        };
    }

    get end() {
        return {
            productionBuild() {
                if (this.abort) return;
                const done = this.async();
                this.log(chalk.bold('\nBuilding application'));

                const child = this.buildApplication(this.buildTool, 'prod', (err) => {
                    if (err) {
                        this.abort = true;
                        this.log.error(err);
                    }
                    done();
                });

                this.buildCmd = child.buildCmd;

                child.stdout.on('data', (data) => {
                    const line = data.toString().trim();
                    if (line.length !== 0) this.log(line);
                });
            },

            productionDeploy() {
                if (this.abort) return;
                const done = this.async();
                this.log(chalk.bold('\nDeploying application'));

                let warFileWildcard = 'target/*.war';
                if (this.buildTool === 'gradle') {
                    warFileWildcard = 'build/libs/*.war';
                }

                const files = glob.sync(warFileWildcard, {});
                const warFile = files[0];
                const herokuDeployCommand = `heroku deploy:jar ${warFile} --app ${this.herokuAppName}`;

                this.log(chalk.bold(`\nUploading your application code.\nThis may take ${chalk.cyan('several minutes')} depending on your connection speed...`));
                const child = exec(herokuDeployCommand, (err, stdout) => {
                    if (err) {
                        this.abort = true;
                        this.log.error(err);
                    }
                    this.log(chalk.green(`\nYour app should now be live. To view it run\n\t${chalk.bold('heroku open')}`));
                    this.log(chalk.yellow(`And you can view the logs with this command\n\t${chalk.bold('heroku logs --tail')}`));
                    this.log(chalk.yellow(`After application modification, redeploy it with\n\t${chalk.bold('jhipster heroku')}`));
                    done();
                });

                child.stdout.on('data', (data) => {
                    const line = data.toString().trimRight();
                    if (line.trim().length !== 0) this.log(line);
                });
            }
        };
    }
};
