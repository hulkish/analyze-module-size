/* eslint-env mocha */

const chai = require('chai')
chai.use(require('dirty-chai'))
const expect = chai.expect

function check (explanation) {
  return {
    expect: (value) => expect(value, explanation)
  }
}

const {Package} = require('../src/Package')
const {PackageStats} = require('../src/PackageStats')
const deep = require('deep-aplus')(Promise)
const path = require('path')

describe('The Package-class:', function () {
  describe('The loadFrom static-method', function () {
    it('should load the package from a directory with the #loadFrom static-method', function () {
      return Package.loadFrom('test/fixtures/project1/package.json')
        .then((pkg) => {
          expect(pkg.packageJson).to.deep.equal(require('./fixtures/project1/package.json'))
          expect(pkg.stats.files.map((f) => f.file).sort()).to.deep.equal([
            f('test/fixtures/project1/'),
            f('test/fixtures/project1/dir/'),
            f('test/fixtures/project1/dir/file2.txt'),
            f('test/fixtures/project1/file3.txt'),
            f('test/fixtures/project1/file5000.txt'),
            f('test/fixtures/project1/file6.txt'),
            f('test/fixtures/project1/package.json')
          ])
        })
    })

    it('should respect the files property in the package.json', function () {
      return Package.loadFrom('test/fixtures/project3/package.json')
        .then((pkg) => {
          expect(pkg.packageJson).to.deep.equal(require('./fixtures/project3/package.json'))
          expect(pkg.stats.files.map((f) => f.file).sort()).to.deep.equal([
            f('test/fixtures/project3/'),
            f('test/fixtures/project3/LICENSE.md'),
            f('test/fixtures/project3/README'),
            f('test/fixtures/project3/dir/'),
            f('test/fixtures/project3/dir/file2.txt'),
            f('test/fixtures/project3/file3.txt'),
            f('test/fixtures/project3/package.json')
          ])
        })
    })
  })

  it('should contain "/" as location by default (because this is the base package.json then', function () {
    expect(dummy('base@1.0.0', undefined, undefined).location()).to.equal('/')
  })

  describe('The #indexByLocation', function () {
    it('should index packages by location using the #indexByLocation static-method', function () {
      const pkg1 = dummy('one@1.0.0', '/one', ['/'])
      const pkg2 = dummy('two@1.0.0', '/two', ['/'])
      const map = Package.indexByLocation([pkg1, pkg2])

      expect(map.get('/one'), 'Checking key /one').to.equal(pkg1)
      expect(map.get('/two'), 'Checking key /two').to.equal(pkg2)
    })

    it('should provide a #USER key with a dummy package as root for manually installed packages', function () {
      const pkg1 = dummy('one@1.0.0', '/one', ['/'])
      const map = Package.indexByLocation([pkg1])
      expect(map.get('#USER')).to.be.an.instanceof(Package)
    })

    it('should provide a #DEV key with a dummy package as root for dev-dependencies', function () {
      const pkg1 = dummy('one@1.0.0', '/one', ['/'])
      const map = Package.indexByLocation([pkg1])
      expect(map.get('#DEV:/')).to.be.an.instanceof(Package)
    })
  })

  describe('The #connect method', function () {
    it('should wire dependency relations using the #connect method', function () {
      const pkg1 = dummy('one@1.0.0', '/one', ['/'])
      const pkg2 = dummy('two@1.0.0', '/two', ['/one'])
      const map = Package.indexByLocation([pkg1, pkg2])

      pkg2.connect(map)

      expect(pkg1.dependencies).to.deep.equal([pkg2])
      expect(pkg2.dependents).to.deep.equal([pkg1])
    })

    it('should create dummy packages for missing dependents', function () {
      const pkg1 = dummy('one@1.0.0', '/one', ['/three'])
      const map = Package.indexByLocation([pkg1])
      pkg1.connect(map)

      // Checking dummy package
      let dummyPackage = map.get('/three')
      expect(dummyPackage.packageJson._id).to.equal('/three')
      expect(dummyPackage.location()).to.equal('/three')
      expect(dummyPackage.dependents).to.deep.equal([map.get('#MISSING')])
      expect(dummyPackage.dependencies).to.deep.equal([pkg1])
    })

    it('should wire packages with one missing and one existing dependent to both dummy and existing package', function () {
      const pkg1 = dummy('one@1.0.0', '/one', ['/three', '/'])
      const root = dummy('root@1.0.0', '/', [])
      const map = Package.indexByLocation([pkg1, root])
      pkg1.connect(map)

      // Checking dummy package
      let dummyPackage = map.get('/three')
      expect(dummyPackage.packageJson._id).to.equal('/three')
      expect(dummyPackage.location()).to.equal('/three')
      expect(dummyPackage.dependents).to.deep.equal([map.get('#MISSING')])
      expect(dummyPackage.dependencies).to.deep.equal([pkg1])

      // Checking dependency wirings
      expect(root.dependencies).to.deep.equal([pkg1])
      expect(pkg1.dependents).to.have.members([root, dummyPackage])
    })

    it('should ignore missing _requiredBy fields', function () {
      const pkg1 = dummy('one@1.0.0', '/one', undefined)
      const pkg2 = dummy('two@1.0.0', '/two', ['/one'])
      const map = Package.indexByLocation([pkg1, pkg2])

      pkg1.connect(map)

      expect(pkg1.dependents).to.deep.equal([])
    })
  })

  describe('The #connectAll static method', function () {
    it('should connect a number of packages', function () {
      const base = dummy('base@1.0.0', undefined, undefined)
      const pkg1 = dummy('one@1.0.0', '/one', ['/'])
      const pkg2 = dummy('two@1.0.0', '/two', ['/one'])
      const result = Package.connectAll(base, [pkg1, pkg2])

      expect(result).to.deep.equal({
        prod: [pkg1],
        dev: [],
        missing: [],
        manual: []
      })
      expect(base.dependencies).to.deep.equal([pkg1])
      expect(pkg1.dependents).to.deep.equal([base])
      expect(pkg1.dependencies).to.deep.equal([pkg2])
      expect(pkg2.dependents).to.deep.equal([pkg1])
    })

    it('should connect missing dependents to "missing"', function () {
      const base = dummy('base@1.0.0', undefined, undefined)
      const pkg1 = dummy('one@1.0.0', '/one', ['/three', '/'])
      const pkg2 = dummy('two@1.0.0', '/two', ['/three'])
      // /three is missing

      const result = Package.connectAll(base, [pkg1, pkg2])

      check('the base package').expect(result.prod).to.deep.equal(base.dependencies)
      check('number of missing packages').expect(result.missing.length).to.equal(1)
      const dummyPkg3 = result.missing[0]
      check('id of missing package').expect(dummyPkg3.packageJson._id).to.equal('/three')
      check('location of missing package').expect(dummyPkg3.location()).to.equal('/three')
      check('dependencies of missing package /three').expect(dummyPkg3.dependencies).to.have.members([pkg1, pkg2])

      check('dependencies of the base package').expect(base.dependencies).to.deep.equal([pkg1])
      check('dependents of pkg1').expect(pkg1.dependents).to.have.members([base, dummyPkg3])
      check('dependents of pkg2').expect(pkg2.dependents).to.deep.equal([dummyPkg3])
    })
  })

  describe('The #totalDependencies method', function () {
    it('should return the total number of dependencies of a package', function () {
      const base = dummy('base@1.0.0', undefined, undefined)
      const pkg1 = dummy('one@1.0.0', '/one', ['/'])
      const pkg2 = dummy('two@1.0.0', '/two', ['/one'])
      const pkg3 = dummy('dev@1.0.0', '/dev', ['#DEV:/'])
      Package.connectAll(base, [pkg1, pkg2, pkg3])
      expect(base.totalDependencies()).to.equal(2)
    })

    it('should ignore cyclic dependencies', function () {
      const base = dummy('base@1.0.0', undefined, undefined)
      const pkg1 = dummy('one@1.0.0', '/one', ['/', '/three'])
      const pkg2 = dummy('two@1.0.0', '/two', ['/one'])
      const pkg3 = dummy('dev@1.0.0', '/three', ['/two'])
      Package.connectAll(base, [pkg1, pkg2, pkg3])
      expect(base.totalDependencies()).to.equal(3)
    })
  })

  describe('The #totalStats method', function () {
    var stats1
    var stats2

    before(function () {
      return deep({
        stats1: PackageStats.loadFrom('test/fixtures/project1'),
        stats2: PackageStats.loadFrom('test/fixtures/project2')
      }).then(function (result) {
        stats1 = result.stats1
        stats2 = result.stats2
      })
    })

    it('should return an aggregated PackageStats-Object', function () {
      const base = dummy('base@1.0.0', undefined, undefined)
      const pkg1 = dummy('one@1.0.0', '/one', ['/'], stats1)
      const pkg2 = dummy('two@1.0.0', '/two', ['/one'], stats2)
      const pkg3 = dummy('dev@1.0.0', '/dev', ['#DEV:/'])
      Package.connectAll(base, [pkg1, pkg2, pkg3])
      expect(base.totalStats()).to.deep.equal(new PackageStats('/base@1.0.0', []).merge([stats1, stats2]))
    })

    it('should stop traversing at dependency cycles', function () {
      const base = dummy('base@1.0.0', undefined, undefined)
      const pkg1 = dummy('one@1.0.0', '/one', ['/', '/two'], stats1)
      const pkg2 = dummy('two@1.0.0', '/two', ['/one'], stats2)
      Package.connectAll(base, [pkg1, pkg2])
      expect(base.totalStats()).to.deep.equal(new PackageStats('/base@1.0.0', []).merge([stats1, stats2]))
    })
  })
})

/**
 * Create a dummy package for testing
 *
 * @param _id
 * @param _location
 * @param _requiredBy
 * @param {PackageStats=} stats
 * @returns {Package}
 */
function dummy (_id, _location, _requiredBy, stats) {
  return new Package({_id, _location, _requiredBy}, stats || new PackageStats(`/${_id}`, []))
}

/**
 * Normalizer file paths
 */
function f (file) {
  return file.replace(/\//g, path.sep)
}
